// « Faire l'appel » (réservé aux enseignants, dans leurs classes uniquement) : l'enseignant ouvre la liste des élèves d'une classe pour une date et marque les absents.
const express = require('express');
const { q, tx } = require('../db');
const { allow } = require('../auth');
const { audit } = require('../audit');
const { ah, HttpError, TEACH_CLASSES } = require('../util');
const config = require('../config');
const A = require('../services/absences');
const S = require('../services/suivi');

const r = express.Router();

async function loadClasse(user, classeId) {
  const id = Number(classeId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Classe invalide');
  const c = (await q('SELECT id, annee_scolaire FROM classes WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!c) throw new HttpError(404, 'Classe introuvable');
  const params = [];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const ok = await q(`SELECT 1 WHERE ${p(id)}::int IN (${TEACH_CLASSES(p, user.id)})`, params);
  if (!ok.rowCount) throw new HttpError(403, "Cette classe n'est pas dans vos classes");
  return c;
}

// Classes sur lesquelles l'enseignant peut faire l'appel : les siennes
r.get('/classes', allow('enseignant'), ah(async (req, res) => {
  const params = [req.query.annee || config.anneeCourante];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const where = ['c.deleted_at IS NULL', 'c.annee_scolaire=$1', `c.id IN (${TEACH_CLASSES(p, req.user.id)})`];
  const { rows } = await q(
    `SELECT c.id, c.niveau||COALESCE(' '||c.section,'') AS nom,
            (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='actif')::int AS effectif
     FROM classes c WHERE ${where.join(' AND ')} ORDER BY c.niveau, c.section`, params);
  res.json(rows);
}));

// Liste des élèves actifs de la classe + absence éventuelle à la date demandée
r.get('/', allow('enseignant'), ah(async (req, res) => {
  const classe = await loadClasse(req.user, req.query.classe_id);
  const date = A.checkDateAbsence(req.query.date || A.aujourdhui(), { user: req.user, annee: classe.annee_scolaire });
  const { rows } = await q(
    `SELECT e.id AS eleve_id, e.nom, e.prenom, a.id AS absence_id, a.periode, a.motif, COALESCE(a.justifiee,false) AS justifiee,
            r.id AS retard_id, r.minutes AS retard_minutes, r.motif AS retard_motif, COALESCE(r.justifie,false) AS retard_justifie
     FROM eleves e
     LEFT JOIN LATERAL (SELECT * FROM absences x WHERE x.eleve_id=e.id AND x.date_absence=$2 AND x.deleted_at IS NULL ORDER BY x.id LIMIT 1) a ON TRUE
     LEFT JOIN LATERAL (SELECT * FROM retards y WHERE y.eleve_id=e.id AND y.date_retard=$2 AND y.deleted_at IS NULL ORDER BY y.id LIMIT 1) r ON TRUE
     WHERE e.classe_id=$1 AND e.deleted_at IS NULL AND e.statut='actif' ORDER BY e.nom, e.prenom`, [classe.id, date]);
  res.json({ date, classe_id: classe.id, eleves: rows });
}));

// Enregistrement de l'appel : `absents` = liste complète des élèves absents ce jour-là
r.put('/', allow('enseignant'), ah(async (req, res) => {
  const classe = await loadClasse(req.user, req.body.classe_id);
  const date = A.checkDateAbsence(req.body.date_absence, { user: req.user, annee: classe.annee_scolaire });
  if (!Array.isArray(req.body.absents)) throw new HttpError(400, 'Liste des absents invalide');
  if (req.body.absents.length > 200) throw new HttpError(400, "Trop d'élèves dans la liste");

  const absents = new Map();
  for (const it of req.body.absents) {
    const id = Number(it?.eleve_id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Élève invalide');
    if (absents.has(id)) throw new HttpError(400, 'Un élève ne peut être marqué absent qu\'une seule fois');
    absents.set(id, { periode: A.checkPeriode(it.periode || 'journee'), motif: A.checkMotif(it.motif) });
  }

  // Retards d'arrivée (facultatif) : `retards` = liste complète des élèves arrivés en retard ce jour-là. S'il est absent du corps,
  // les retards déjà saisis ne sont pas touchés (compatibilité avec l'application mobile).
  let retardsVoulus = null;
  if (req.body.retards !== undefined) {
    if (!Array.isArray(req.body.retards)) throw new HttpError(400, 'Liste des retards invalide');
    if (req.body.retards.length > 200) throw new HttpError(400, "Trop d'élèves dans la liste des retards");
    retardsVoulus = new Map();
    for (const it of req.body.retards) {
      const id = Number(it?.eleve_id);
      if (!Number.isInteger(id)) throw new HttpError(400, 'Élève invalide (retards)');
      if (retardsVoulus.has(id)) throw new HttpError(400, "Un élève ne peut être noté en retard qu'une seule fois");
      if (absents.has(id) && absents.get(id).periode === 'journee') throw new HttpError(400, 'Un élève absent toute la journée ne peut pas être en retard');
      retardsVoulus.set(id, { minutes: S.checkMinutes(it.minutes), motif: A.checkMotif(it.motif) });
    }
  }
  const bilan = { crees: 0, modifies: 0, supprimes: 0, conserves: 0, retards: 0 };
  const nouvelles = []; const nouveauxRetards = [];
  await tx(async (cl) => {
    const eleves = (await cl.query("SELECT id FROM eleves WHERE classe_id=$1 AND deleted_at IS NULL AND statut='actif'", [classe.id])).rows.map((e) => e.id);
    for (const id of absents.keys()) if (!eleves.includes(id)) throw new HttpError(400, "Un élève n'appartient pas à cette classe (ou n'est plus actif)");

    const existantes = (await cl.query(
      'SELECT * FROM absences WHERE eleve_id = ANY($1::int[]) AND date_absence=$2 AND deleted_at IS NULL ORDER BY id', [eleves, date])).rows;
    const parEleve = new Map();
    for (const a of existantes) if (!parEleve.has(a.eleve_id)) parEleve.set(a.eleve_id, a);

    for (const [eleveId, a] of parEleve) {
      const verrou = a.justifiee; // absence justifiée : seule la direction peut la modifier (page Absences)
      const voulu = absents.get(eleveId);
      if (!voulu) {
        if (verrou) { bilan.conserves++; continue; }
        await cl.query('UPDATE absences SET deleted_at=now() WHERE id=$1', [a.id]);
        await audit(cl, req.user, 'delete', 'absences', a.id, a, null);
        bilan.supprimes++;
      } else if (a.periode !== voulu.periode || (a.motif || null) !== voulu.motif) {
        if (verrou) { bilan.conserves++; continue; }
        const n = (await cl.query('UPDATE absences SET periode=$1, motif=$2 WHERE id=$3 RETURNING *', [voulu.periode, voulu.motif, a.id])).rows[0];
        await audit(cl, req.user, 'update', 'absences', a.id, a, n);
        bilan.modifies++;
      }
    }
    for (const [eleveId, voulu] of absents) {
      if (parEleve.has(eleveId)) continue;
      const n = (await cl.query(
        'INSERT INTO absences(eleve_id,date_absence,periode,motif,annee_scolaire) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [eleveId, date, voulu.periode, voulu.motif, classe.annee_scolaire || config.anneeCourante])).rows[0];
      await audit(cl, req.user, 'create', 'absences', n.id, null, n);
      nouvelles.push(n);
      bilan.crees++;
    }

    if (retardsVoulus) {
      for (const id of retardsVoulus.keys()) if (!eleves.includes(id)) throw new HttpError(400, "Un élève en retard n'appartient pas à cette classe (ou n'est plus actif)");
      const exist = new Map((await cl.query('SELECT * FROM retards WHERE eleve_id = ANY($1::int[]) AND date_retard=$2 AND deleted_at IS NULL', [eleves, date])).rows.map((x) => [x.eleve_id, x]));
      for (const [eleveId, a] of exist) {
        const voulu = retardsVoulus.get(eleveId);
        if (a.justifie) { bilan.conserves++; continue; } // retard justifié : seule la direction peut le modifier
        if (!voulu) { await cl.query('UPDATE retards SET deleted_at=now() WHERE id=$1', [a.id]); await audit(cl, req.user, 'delete', 'retards', a.id, a, null); bilan.supprimes++; }
        else if (a.minutes !== voulu.minutes || (a.motif || null) !== voulu.motif) {
          const n = (await cl.query('UPDATE retards SET minutes=$1, motif=$2 WHERE id=$3 RETURNING *', [voulu.minutes, voulu.motif, a.id])).rows[0];
          await audit(cl, req.user, 'update', 'retards', a.id, a, n); bilan.modifies++;
        }
      }
      for (const [eleveId, voulu] of retardsVoulus) {
        if (exist.has(eleveId)) continue;
        await S.checkDoublonRetard(cl, eleveId, date); // refuse si l'élève est absent toute la journée (absence déjà enregistrée)
        const n = (await cl.query('INSERT INTO retards(eleve_id,date_retard,minutes,motif,annee_scolaire) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [eleveId, date, voulu.minutes, voulu.motif, classe.annee_scolaire || config.anneeCourante])).rows[0];
        await audit(cl, req.user, 'create', 'retards', n.id, null, n); nouveauxRetards.push(n); bilan.retards++;
      }
    }
  });
  // Notification des parents / de l'élève (après validation de la transaction, sans bloquer la réponse)
  Promise.allSettled(nouvelles.map((n) => A.notifierAbsence(n))).then((r) => r.filter((x) => x.status === 'rejected').forEach((x) => console.error('[absence] notification', x.reason?.message)));
  Promise.allSettled(nouveauxRetards.map((n) => S.notifierRetard(n))).then((r) => r.filter((x) => x.status === 'rejected').forEach((x) => console.error('[retard] notification', x.reason?.message)));
  res.json({ ok: true, date, ...bilan, absents: absents.size });
}));

module.exports = r;

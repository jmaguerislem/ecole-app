// « Faire l'appel » : l'enseignant ouvre la liste des élèves d'une classe pour une date et marque les absents.
const express = require('express');
const { q, tx } = require('../db');
const { allow } = require('../auth');
const { audit } = require('../audit');
const { ah, HttpError, TEACH_CLASSES } = require('../util');
const config = require('../config');
const A = require('../services/absences');

const r = express.Router();

async function loadClasse(user, classeId) {
  const id = Number(classeId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Classe invalide');
  const c = (await q('SELECT id, annee_scolaire FROM classes WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!c) throw new HttpError(404, 'Classe introuvable');
  if (user.role === 'enseignant') {
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };
    const ok = await q(`SELECT 1 WHERE ${p(id)}::int IN (${TEACH_CLASSES(p, user.id)})`, params);
    if (!ok.rowCount) throw new HttpError(403, "Cette classe n'est pas dans vos classes");
  }
  return c;
}

// Classes sur lesquelles l'utilisateur peut faire l'appel (enseignant : les siennes ; admin : toutes)
r.get('/classes', allow('admin', 'enseignant'), ah(async (req, res) => {
  const params = [req.query.annee || config.anneeCourante];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const where = ['c.deleted_at IS NULL', 'c.annee_scolaire=$1'];
  if (req.user.role === 'enseignant') where.push(`c.id IN (${TEACH_CLASSES(p, req.user.id)})`);
  const { rows } = await q(
    `SELECT c.id, c.niveau||COALESCE(' '||c.section,'') AS nom,
            (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='actif')::int AS effectif
     FROM classes c WHERE ${where.join(' AND ')} ORDER BY c.niveau, c.section`, params);
  res.json(rows);
}));

// Liste des élèves actifs de la classe + absence éventuelle à la date demandée
r.get('/', allow('admin', 'enseignant'), ah(async (req, res) => {
  const classe = await loadClasse(req.user, req.query.classe_id);
  const date = A.checkDateAbsence(req.query.date || A.aujourdhui(), { user: req.user, annee: classe.annee_scolaire });
  const { rows } = await q(
    `SELECT e.id AS eleve_id, e.nom, e.prenom, a.id AS absence_id, a.periode, a.motif, COALESCE(a.justifiee,false) AS justifiee
     FROM eleves e
     LEFT JOIN LATERAL (SELECT * FROM absences x WHERE x.eleve_id=e.id AND x.date_absence=$2 AND x.deleted_at IS NULL ORDER BY x.id LIMIT 1) a ON TRUE
     WHERE e.classe_id=$1 AND e.deleted_at IS NULL AND e.statut='actif' ORDER BY e.nom, e.prenom`, [classe.id, date]);
  res.json({ date, classe_id: classe.id, eleves: rows });
}));

// Enregistrement de l'appel : `absents` = liste complète des élèves absents ce jour-là
r.put('/', allow('admin', 'enseignant'), ah(async (req, res) => {
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

  const bilan = { crees: 0, modifies: 0, supprimes: 0, conserves: 0 };
  const nouvelles = [];
  await tx(async (cl) => {
    const eleves = (await cl.query("SELECT id FROM eleves WHERE classe_id=$1 AND deleted_at IS NULL AND statut='actif'", [classe.id])).rows.map((e) => e.id);
    for (const id of absents.keys()) if (!eleves.includes(id)) throw new HttpError(400, "Un élève n'appartient pas à cette classe (ou n'est plus actif)");

    const existantes = (await cl.query(
      'SELECT * FROM absences WHERE eleve_id = ANY($1::int[]) AND date_absence=$2 AND deleted_at IS NULL ORDER BY id', [eleves, date])).rows;
    const parEleve = new Map();
    for (const a of existantes) if (!parEleve.has(a.eleve_id)) parEleve.set(a.eleve_id, a);

    for (const [eleveId, a] of parEleve) {
      const verrou = a.justifiee && req.user.role !== 'admin'; // absence justifiée par un parent : seul l'admin peut la changer
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
  });
  // Notification des parents / de l'élève (après validation de la transaction, sans bloquer la réponse)
  Promise.allSettled(nouvelles.map((n) => A.notifierAbsence(n))).then((r) => r.filter((x) => x.status === 'rejected').forEach((x) => console.error('[absence] notification', x.reason?.message)));
  res.json({ ok: true, date, ...bilan, absents: absents.size });
}));

module.exports = r;

// Emploi du temps, paiements, notes/bulletins, import-export élèves, pré-inscriptions
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { q, tx } = require('../db');
const { allow } = require('../auth');
const { audit } = require('../audit');
const crud = require('../crud');
const { memUpload } = require('../services/storage');
const { notify, sendMessage } = require('../services/notify');
const { solde, impayes } = require('../services/finance');
const { computeBulletin } = require('../services/bulletin');
const { receiptPdf, bulletinPdf } = require('../services/pdf');
const { ah, HttpError, pad, anneeDebut, checkNaissance, checkTelephone, eleveScope, teacherCanTeach, canAccessEleve, parentsOf } = require('../util');
const config = require('../config');
const V = require('../services/validate');
const { verifierQuota } = require('../services/quotas');
const { qa, runWith } = require('../db');
const { abonnementBloque } = require('../auth');

const CLASSE_NOM = (a) => `${a}.niveau||COALESCE(' '||${a}.section,'')`;

// ================= Emploi du temps =================
const creneaux = crud({
  table: 'creneaux', fields: ['classe_id', 'matiere_id', 'enseignant_id', 'salle_id', 'jour', 'heure_debut', 'heure_fin'],
  required: ['classe_id', 'matiere_id', 'enseignant_id', 'jour', 'heure_debut', 'heure_fin'], annee: true,
  read: ['admin', 'enseignant', 'comptable', 'parent', 'eleve'], write: ['admin', 'enseignant'], filters: ['classe_id', 'enseignant_id'],
  from: `creneaux t JOIN classes c ON c.id=t.classe_id JOIN matieres m ON m.id=t.matiere_id JOIN users u ON u.id=t.enseignant_id LEFT JOIN salles s ON s.id=t.salle_id`,
  columns: `t.*, ${CLASSE_NOM('c')} AS classe_nom, m.nom AS matiere_nom, u.nom||' '||u.prenom AS enseignant_nom, s.nom AS salle_nom`,
  order: 't.jour, t.heure_debut',
  scope: (u, p) => {
    if (u.role === 'parent') return `t.classe_id IN (SELECT e.classe_id FROM eleves e JOIN eleve_parents ep ON ep.eleve_id=e.id WHERE ep.parent_id=${p(u.id)})`;
    if (u.role === 'eleve') return `t.classe_id IN (SELECT classe_id FROM eleves WHERE user_id=${p(u.id)})`;
    if (u.role === 'enseignant') return `(t.enseignant_id=${p(u.id)} OR t.classe_id IN (SELECT id FROM classes WHERE titulaire_id=${p(u.id)}))`;
    return null;
  },
  async beforeSave({ merged, old, user, client, data }) {
    if (data.jour !== undefined) data.jour = V.nombre(data.jour, 'Le jour', { min: 1, max: 6, entier: true, required: true });
    for (const [k, l] of [['heure_debut', "L'heure de début"], ['heure_fin', "L'heure de fin"]]) if (data[k] !== undefined) { data[k] = V.heure(data[k], l); merged[k] = data[k]; }
    merged.heure_debut = String(merged.heure_debut).slice(0, 5); merged.heure_fin = String(merged.heure_fin).slice(0, 5);
    if (merged.heure_debut < '07:00' || merged.heure_fin > '19:00') throw new HttpError(400, 'Les cours doivent se situer entre 07:00 et 19:00');
    const minutes = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const duree = minutes(merged.heure_fin) - minutes(merged.heure_debut);
    if (duree < 15) throw new HttpError(400, 'Un cours dure au moins 15 minutes');
    if (duree > 240) throw new HttpError(400, 'Un cours ne peut pas dépasser 4 heures');
    if (user.role === 'enseignant' && Number(merged.enseignant_id) !== user.id) throw new HttpError(403, 'Un enseignant ne peut gérer que ses propres créneaux');
    if (merged.heure_debut >= merged.heure_fin) throw new HttpError(400, "L'heure de fin doit suivre l'heure de début");
    if (merged.salle_id) {
      const s = await client.query('SELECT disponible FROM salles WHERE id=$1 AND deleted_at IS NULL', [merged.salle_id]);
      if (!s.rows[0]) throw new HttpError(400, 'Salle introuvable');
      if (!s.rows[0].disponible) throw new HttpError(409, "Cette salle n'est pas disponible");
    }
    const { rows } = await client.query(
      `SELECT t.enseignant_id, t.salle_id, t.classe_id FROM creneaux t
       WHERE t.deleted_at IS NULL AND t.annee_scolaire=$1 AND t.jour=$2 AND t.heure_debut<$4 AND t.heure_fin>$3 AND t.id<>$5
         AND (t.enseignant_id=$6 OR (t.salle_id IS NOT NULL AND t.salle_id=$7) OR t.classe_id=$8) LIMIT 1`,
      [merged.annee_scolaire, merged.jour, merged.heure_debut, merged.heure_fin, old ? old.id : 0, merged.enseignant_id, merged.salle_id || null, merged.classe_id]);
    if (rows[0]) {
      const c = rows[0];
      const quoi = Number(c.enseignant_id) === Number(merged.enseignant_id) ? "L'enseignant" : c.salle_id && Number(c.salle_id) === Number(merged.salle_id) ? 'La salle' : 'La classe';
      throw new HttpError(409, `Conflit d'emploi du temps : ${quoi} est déjà affecté(e) à un autre cours sur ce créneau.`);
    }
  },
});

// ================= Paiements =================
const paiementsExtra = express.Router();
paiementsExtra.get('/impayes', allow('admin', 'comptable'), ah(async (req, res) => res.json(await impayes(req.query.annee || config.anneeCourante))));
paiementsExtra.get('/solde/:eleveId(\\d+)', ah(async (req, res) => {
  if (!(await canAccessEleve(req.user, req.params.eleveId, { finance: true }))) throw new HttpError(403, 'Accès refusé');
  res.json(await solde(req.params.eleveId, req.query.annee || config.anneeCourante));
}));
paiementsExtra.post('/relances', allow('admin', 'comptable'), ah(async (req, res) => {
  res.json({ envoyees: await envoyerRelances(req.user.id) });
}));
paiementsExtra.get('/:id(\\d+)/recu', ah(async (req, res) => {
  const p = (await q(`SELECT p.*, e.nom||' '||e.prenom AS eleve_nom, e.matricule, t.libelle AS tarif_libelle FROM paiements p JOIN eleves e ON e.id=p.eleve_id LEFT JOIN tarifs t ON t.id=p.tarif_id WHERE p.id=$1 AND p.deleted_at IS NULL`, [req.params.id])).rows[0];
  if (!p) throw new HttpError(404, 'Paiement introuvable');
  if (!(await canAccessEleve(req.user, p.eleve_id, { finance: true }))) throw new HttpError(403, 'Accès refusé');
  receiptPdf(res, p, await solde(p.eleve_id, p.annee_scolaire));
}));

async function envoyerRelances(senderId) {
  const list = await impayes();
  let n = 0;
  for (const i of list) {
    const parents = await parentsOf(i.eleve_id);
    if (!parents.length) continue;
    await sendMessage({
      sender_id: senderId, recipients: parents, eleve_id: i.eleve_id, email: true,
      objet: `Rappel de paiement – ${i.prenom} ${i.nom}`,
      corps: `Bonjour,\n\nSauf erreur de notre part, un solde de ${i.solde.toFixed(2)} TND reste à régler pour ${i.prenom} ${i.nom} (année ${config.anneeCourante}).\nMerci de régulariser dès que possible.\n\nLe secrétariat`,
    });
    n++;
  }
  return n;
}

const paiements = crud({
  table: 'paiements', fields: ['eleve_id', 'tarif_id', 'montant', 'mode', 'date_paiement', 'reference', 'notes'], required: ['eleve_id', 'montant', 'mode'], annee: true,
  read: ['admin', 'comptable', 'parent', 'eleve'], write: ['admin', 'comptable'], filters: ['eleve_id', 'mode'], searchFields: ['e.nom', 'e.prenom', 't.numero_recu', 't.reference'],
  from: 'paiements t JOIN eleves e ON e.id=t.eleve_id LEFT JOIN tarifs tr ON tr.id=t.tarif_id',
  columns: `t.*, e.nom||' '||e.prenom AS eleve_nom, e.matricule, tr.libelle AS tarif_libelle`, order: 't.date_paiement DESC, t.id DESC',
  scope: (u, p) => eleveScope(p, u, 't.eleve_id'),
  async beforeSave({ merged, user, isNew, data }) {
    if (data.montant !== undefined || isNew) data.montant = merged.montant = V.nombre(merged.montant, 'Le montant', { min: 0.01, max: 100000, required: true });
    V.choix(merged.mode, 'Le mode de paiement', ['especes', 'virement', 'mobile_money'], { required: true });
    if (data.date_paiement !== undefined) data.date_paiement = V.date(data.date_paiement, 'La date de paiement', { max: V.aujourdhui() });
    if (data.reference !== undefined || data.mode !== undefined) {
      data.reference = V.texte(merged.reference, 'La référence', { max: 60, re: /^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u, reMsg: 'La référence : lettres, chiffres, espaces et . _ / - uniquement' });
      if (merged.mode !== 'especes' && !data.reference) throw new HttpError(400, 'La référence est obligatoire pour un virement ou un paiement mobile');
    }
    if (data.notes !== undefined) data.notes = V.texte(data.notes, 'Les notes', { max: 500, multiligne: true });
    if (isNew) data.created_by = user.id;
  },
  async afterSave({ client, row, isNew }) {
    if (isNew) await client.query('UPDATE paiements SET numero_recu=$1 WHERE id=$2', [`REC-${anneeDebut(row.annee_scolaire)}-${pad(row.id)}`, row.id]);
  },
  // Après commit : message automatique au parent (interne + e-mail/push) – journalisé
  async afterCommit({ row, user, isNew }) {
    if (!isNew) return;
    const s = await solde(row.eleve_id, row.annee_scolaire);
    const parents = await parentsOf(row.eleve_id);
    if (!parents.length) return;
    const MODES = { especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile money' };
    const num = `REC-${anneeDebut(row.annee_scolaire)}-${pad(row.id)}`;
    await sendMessage({
      sender_id: user.id, recipients: parents, eleve_id: row.eleve_id, email: true,
      objet: `Paiement reçu – ${num}`,
      corps: `Bonjour,\n\nNous avons bien enregistré un paiement pour ${s.prenom} ${s.nom} :\n- Montant payé : ${Number(row.montant).toFixed(2)} TND\n- Date : ${row.date_paiement}\n- Mode : ${MODES[row.mode] || row.mode}\n- Nouveau solde restant : ${s.solde.toFixed(2)} TND\n\nTéléchargez votre reçu : ${config.appUrl}/recu/${row.id} (connexion requise).\n\nMerci.`,
    });
  },
});

// ================= Notes & bulletins =================
const notes = express.Router();
async function loadEval(req) {
  const ev = (await q(`SELECT ev.*, m.nom AS matiere_nom, ${CLASSE_NOM('c')} AS classe_nom FROM evaluations ev JOIN matieres m ON m.id=ev.matiere_id JOIN classes c ON c.id=ev.classe_id WHERE ev.id=$1 AND ev.deleted_at IS NULL`, [req.params.id])).rows[0];
  if (!ev) throw new HttpError(404, 'Évaluation introuvable');
  if (!(await teacherCanTeach(req.user, ev.classe_id, ev.matiere_id))) throw new HttpError(403, 'Accès refusé');
  return ev;
}
notes.get('/evaluations/:id(\\d+)/notes', allow('admin', 'enseignant'), ah(async (req, res) => {
  const ev = await loadEval(req);
  const { rows } = await q(
    `SELECT e.id AS eleve_id, e.nom, e.prenom, n.id AS note_id, n.valeur, n.commentaire FROM eleves e
     LEFT JOIN notes n ON n.eleve_id=e.id AND n.evaluation_id=$1 AND n.deleted_at IS NULL
     WHERE e.classe_id=$2 AND e.deleted_at IS NULL ORDER BY e.nom, e.prenom`, [ev.id, ev.classe_id]);
  res.json({ evaluation: ev, eleves: rows });
}));
// Saisie / modification / suppression groupée (valeur vide = suppression)
notes.put('/evaluations/:id(\\d+)/notes', allow('admin', 'enseignant'), ah(async (req, res) => {
  const ev = await loadEval(req);
  const list = Array.isArray(req.body.notes) ? req.body.notes : [];
  await tx(async (cl) => {
    for (const it of list) {
      const ok = await cl.query('SELECT 1 FROM eleves WHERE id=$1 AND classe_id=$2 AND deleted_at IS NULL', [it.eleve_id, ev.classe_id]);
      if (!ok.rowCount) throw new HttpError(400, "Élève hors de la classe de l'évaluation");
      const old = (await cl.query('SELECT * FROM notes WHERE evaluation_id=$1 AND eleve_id=$2 AND deleted_at IS NULL', [ev.id, it.eleve_id])).rows[0];
      const empty = it.valeur === '' || it.valeur === null || it.valeur === undefined;
      if (empty) {
        if (old) { await cl.query('UPDATE notes SET deleted_at=now() WHERE id=$1', [old.id]); await audit(cl, req.user, 'delete', 'notes', old.id, old, null); }
        continue;
      }
      const v = Number(String(it.valeur).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > ev.bareme) throw new HttpError(400, `Note invalide (0 à ${ev.bareme}) pour l'élève ${it.eleve_id}`);
      if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) throw new HttpError(400, `Note invalide pour l'élève ${it.eleve_id} : par pas de 0,25 (ex. 12 ; 12,25 ; 12,5)`);
      it.commentaire = V.texte(it.commentaire, 'Le commentaire', { max: 300 });
      if (old) {
        if (Number(old.valeur) === v && (old.commentaire || '') === (it.commentaire || '')) continue;
        const nw = (await cl.query('UPDATE notes SET valeur=$1, commentaire=$2 WHERE id=$3 RETURNING *', [v, it.commentaire || null, old.id])).rows[0];
        await audit(cl, req.user, 'update', 'notes', old.id, old, nw);
      } else {
        const nw = (await cl.query('INSERT INTO notes(evaluation_id,eleve_id,valeur,commentaire,annee_scolaire) VALUES ($1,$2,$3,$4,$5) RETURNING *', [ev.id, it.eleve_id, v, it.commentaire || null, ev.annee_scolaire])).rows[0];
        await audit(cl, req.user, 'create', 'notes', nw.id, null, nw);
      }
    }
  });
  res.json({ ok: true });
}));
notes.get('/eleves/:id(\\d+)/bulletin', ah(async (req, res) => {
  if (!(await canAccessEleve(req.user, req.params.id))) throw new HttpError(403, 'Accès refusé');
  const b = await computeBulletin(req.params.id, req.query.trimestre, req.query.annee || config.anneeCourante);
  if (!b) throw new HttpError(404, 'Élève introuvable');
  res.json(b);
}));
notes.get('/eleves/:id(\\d+)/bulletin.pdf', ah(async (req, res) => {
  if (!(await canAccessEleve(req.user, req.params.id))) throw new HttpError(403, 'Accès refusé');
  const b = await computeBulletin(req.params.id, req.query.trimestre, req.query.annee || config.anneeCourante);
  if (!b) throw new HttpError(404, 'Élève introuvable');
  bulletinPdf(res, b);
}));

// ================= Élèves : import/export, affectation automatique =================
const elevesExtra = express.Router();
const LEVELS = { 6: '1ère année', 7: '2ème année', 8: '3ème année', 9: '4ème année', 10: '5ème année', 11: '6ème année' };
elevesExtra.post('/:id(\\d+)/auto-affectation', allow('admin', 'comptable'), ah(async (req, res) => {
  const e = (await q('SELECT * FROM eleves WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!e) throw new HttpError(404, 'Élève introuvable');
  if (!e.date_naissance) throw new HttpError(400, 'Date de naissance requise');
  const ref = new Date(`${anneeDebut(config.anneeCourante)}-09-01`);
  const age = ref.getFullYear() - new Date(e.date_naissance).getFullYear();
  const niveau = LEVELS[Math.min(11, Math.max(6, age))];
  const c = (await q(
    `SELECT c.id FROM classes c WHERE c.niveau=$1 AND c.annee_scolaire=$2 AND c.deleted_at IS NULL
     AND (SELECT COUNT(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL) < c.capacite
     ORDER BY (SELECT COUNT(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL) LIMIT 1`, [niveau, config.anneeCourante])).rows[0];
  if (!c) throw new HttpError(409, `Aucune classe ${niveau} avec une place disponible`);
  await q('UPDATE eleves SET classe_id=$1 WHERE id=$2', [c.id, e.id]);
  await audit(null, req.user, 'update', 'eleves', e.id, { classe_id: e.classe_id }, { classe_id: c.id });
  res.json({ ok: true, classe_id: c.id, niveau });
}));
elevesExtra.get('/export', allow('admin', 'comptable'), ah(async (_req, res) => {
  const { rows } = await q(`SELECT e.matricule, e.nom, e.prenom, e.date_naissance, e.sexe, e.adresse, e.annee_entree, ${CLASSE_NOM('c')} AS classe, e.statut FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.deleted_at IS NULL ORDER BY e.nom`);
  const cols = ['matricule', 'nom', 'prenom', 'date_naissance', 'sexe', 'adresse', 'annee_entree', 'classe', 'statut'];
  const esc = (v) => (v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="eleves.csv"');
  res.send('\ufeff' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n'));
}));
elevesExtra.post('/import', allow('admin', 'comptable'), memUpload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Fichier CSV requis');
  const recs = parse(req.file.buffer.toString('utf8'), { columns: (h) => h.map((x) => x.trim().toLowerCase()), bom: true, skip_empty_lines: true, delimiter: [';', ','], trim: true });
  await verifierQuota(req.user.school_id, 'eleves', recs.length);
  const classes = (await q(`SELECT id, ${CLASSE_NOM('c')} AS nom FROM classes c WHERE annee_scolaire=$1 AND deleted_at IS NULL`, [config.anneeCourante])).rows;
  let importes = 0; const erreurs = [];
  for (const [i, r] of recs.entries()) {
    try {
      r.nom = V.nomPropre(r.nom, 'nom'); r.prenom = V.nomPropre(r.prenom, 'prenom');
      if (r.date_naissance) checkNaissance(r.date_naissance);
      r.sexe = V.choix((r.sexe || '').toUpperCase() || null, 'sexe', ['M', 'F']) || '';
      r.adresse = V.texte(r.adresse, 'adresse', { max: 200 }) || '';
      r.annee_entree = V.annee(r.annee_entree, 'annee_entree') || '';
      r.matricule = (V.texte(r.matricule, 'matricule', { max: 20, re: /^[A-Za-z0-9-]+$/, reMsg: 'matricule : lettres, chiffres et tirets' }) || '').toUpperCase();
      const cl = r.classe ? classes.find((c) => c.nom.toLowerCase() === r.classe.toLowerCase()) : null;
      if (r.classe && !cl) throw new Error(`classe inconnue « ${r.classe} »`);
      const ins = await q(
        `INSERT INTO eleves(matricule,nom,prenom,date_naissance,sexe,adresse,annee_entree,classe_id) VALUES (NULLIF($1,''),$2,$3,NULLIF($4,'')::date,NULLIF($5,''),NULLIF($6,''),$7,$8) RETURNING id`,
        [r.matricule || '', r.nom, r.prenom, r.date_naissance || '', r.sexe || '', r.adresse || '', r.annee_entree || config.anneeCourante, cl ? cl.id : null]);
      await q("UPDATE eleves SET matricule=COALESCE(matricule,$1) WHERE id=$2", [`E${anneeDebut(config.anneeCourante)}${pad(ins.rows[0].id, 4)}`, ins.rows[0].id]);
      importes++;
    } catch (e) { erreurs.push({ ligne: i + 2, message: e.message }); }
  }
  await audit(null, req.user, 'import', 'eleves', null, null, { importes, erreurs: erreurs.length });
  res.json({ importes, erreurs });
}));

// ================= Pré-inscriptions =================
const publicPre = express.Router();
// L'école est celle du lien d'inscription (/api/public/<slug>/preinscriptions). Sans identifiant, seule une plateforme à une école est acceptée.
const resoudreEcole = ah(async (req, res, next) => {
  const slug = req.params.slug || req.query.ecole;
  let school;
  if (slug) school = (await qa("SELECT id,nom,status,subscription_end FROM schools WHERE slug=$1", [String(slug).slice(0, 60)])).rows[0];
  else {
    const l = (await qa("SELECT id,nom,status,subscription_end FROM schools WHERE status<>'suspended' ORDER BY id LIMIT 2")).rows;
    if (l.length !== 1) throw new HttpError(400, "École non précisée : utilisez le lien d'inscription de votre école");
    school = l[0];
  }
  if (!school) throw new HttpError(404, 'École introuvable');
  if (abonnementBloque(school)) throw new HttpError(403, 'Les pré-inscriptions sont fermées pour cette école');
  runWith({ schoolId: school.id, schoolNom: school.nom }, next);
});
publicPre.post(['/preinscriptions', '/:slug/preinscriptions'], resoudreEcole, ah(async (req, res) => {
  const b = req.body || {};
  const need = ['eleve_nom', 'eleve_prenom', 'date_naissance', 'parent_nom', 'parent_prenom', 'parent_email'];
  const miss = need.filter((k) => !b[k]);
  if (miss.length) throw new HttpError(400, `Champs obligatoires : ${miss.join(', ')}`);
  if (!b.consentement_rgpd) throw new HttpError(400, 'Le consentement parental est obligatoire (RGPD)');
  Object.assign(b, V.preinscription(b)); // noms, e-mail, sexe, niveau, adresse, antécédents : contrôlés et nettoyés
  checkNaissance(b.date_naissance);
  checkTelephone(b.parent_telephone);
  const { rows } = await q(
    `INSERT INTO preinscriptions(annee_scolaire,eleve_nom,eleve_prenom,date_naissance,sexe,niveau_souhaite,parent_nom,parent_prenom,parent_email,parent_telephone,adresse,antecedents_medicaux,consentement_rgpd)
     VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,$8,$9,$10,$11,$12,TRUE) RETURNING id`,
    [config.anneeCourante, b.eleve_nom, b.eleve_prenom, b.date_naissance, b.sexe || '', b.niveau_souhaite || '', b.parent_nom, b.parent_prenom, b.parent_email, b.parent_telephone || null, b.adresse || null, b.antecedents_medicaux || null]);
  const admins = (await q("SELECT id FROM users WHERE role IN ('admin','comptable') AND actif AND deleted_at IS NULL")).rows.map((r) => r.id);
  await notify(admins, { type: 'preinscription', titre: 'Nouvelle pré-inscription', corps: `${b.eleve_prenom} ${b.eleve_nom}`, lien: '/preinscriptions' });
  res.status(201).json({ ok: true, id: rows[0].id });
}));

const pre = crud({
  table: 'preinscriptions', annee: true, read: ['admin', 'comptable'], write: ['admin', 'comptable'], filters: ['statut'],
  fields: ['eleve_nom', 'eleve_prenom', 'date_naissance', 'sexe', 'niveau_souhaite', 'parent_nom', 'parent_prenom', 'parent_email', 'parent_telephone', 'adresse', 'antecedents_medicaux'],
  required: ['eleve_nom', 'eleve_prenom', 'date_naissance', 'parent_nom', 'parent_prenom', 'parent_email'],
  searchFields: ['t.eleve_nom', 't.eleve_prenom', 't.parent_nom'], order: "t.statut='en_attente' DESC, t.id DESC",
  async beforeSave({ data, isNew }) {
    if (isNew) data.consentement_rgpd = true;
    Object.assign(data, V.preinscription(data, { complet: false }));
    if (data.date_naissance) checkNaissance(data.date_naissance);
    checkTelephone(data.parent_telephone);
  },
});
const preActions = express.Router();
preActions.post('/:id(\\d+)/valider', allow('admin', 'comptable'), ah(async (req, res) => {
  const out = await tx(async (cl) => {
    const p = (await cl.query("SELECT * FROM preinscriptions WHERE id=$1 AND statut='en_attente' AND deleted_at IS NULL FOR UPDATE", [req.params.id])).rows[0];
    if (!p) throw new HttpError(404, 'Pré-inscription introuvable ou déjà traitée');
    let parent = (await cl.query('SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL', [p.parent_email])).rows[0];
    let motDePasse = null;
    if (!parent) {
      motDePasse = crypto.randomBytes(6).toString('base64url');
      parent = (await cl.query("INSERT INTO users(email,password_hash,role,nom,prenom,telephone,consentement_rgpd_at) VALUES ($1,$2,'parent',$3,$4,$5,now()) RETURNING id",
        [p.parent_email, await bcrypt.hash(motDePasse, 12), p.parent_nom, p.parent_prenom, p.parent_telephone])).rows[0];
    }
    let classe_id = null;
    if (req.body.classe_id) {
      const c = (await cl.query('SELECT capacite, (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=c.id AND e.deleted_at IS NULL) n FROM classes c WHERE id=$1', [req.body.classe_id])).rows[0];
      if (!c) throw new HttpError(400, 'Classe introuvable');
      if (c.n >= c.capacite) throw new HttpError(409, 'Classe complète');
      classe_id = req.body.classe_id;
    }
    const el = (await cl.query(
      'INSERT INTO eleves(nom,prenom,date_naissance,sexe,adresse,antecedents_medicaux,annee_entree,classe_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [p.eleve_nom, p.eleve_prenom, p.date_naissance, p.sexe, p.adresse, p.antecedents_medicaux, p.annee_scolaire, classe_id])).rows[0];
    await cl.query('UPDATE eleves SET matricule=$1 WHERE id=$2', [`E${anneeDebut(p.annee_scolaire)}${pad(el.id, 4)}`, el.id]);
    await cl.query('INSERT INTO eleve_parents(eleve_id,parent_id) VALUES ($1,$2)', [el.id, parent.id]);
    await cl.query("UPDATE preinscriptions SET statut='validee', eleve_id=$1, traitee_par=$2 WHERE id=$3", [el.id, req.user.id, p.id]);
    await audit(cl, req.user, 'validate', 'preinscriptions', p.id, p, { eleve_id: el.id });
    return { eleve_id: el.id, parent_email: p.parent_email, mot_de_passe_temporaire: motDePasse };
  });
  res.json(out);
}));
preActions.post('/:id(\\d+)/refuser', allow('admin', 'comptable'), ah(async (req, res) => {
  const r = await q("UPDATE preinscriptions SET statut='refusee', motif_refus=$1, traitee_par=$2 WHERE id=$3 AND statut='en_attente' RETURNING id", [req.body.motif || null, req.user.id, req.params.id]);
  if (!r.rowCount) throw new HttpError(404, 'Pré-inscription introuvable ou déjà traitée');
  await audit(null, req.user, 'refuse', 'preinscriptions', Number(req.params.id), null, { motif: req.body.motif });
  res.json({ ok: true });
}));

module.exports = { creneaux, paiementsExtra, paiements, notes, elevesExtra, publicPre, pre, preActions, envoyerRelances };

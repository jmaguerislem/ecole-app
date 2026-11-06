// Entités métier gérées par la fabrique CRUD
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const crud = require('../crud');
const { HttpError, checkNaissance, checkTelephone, eleveScope, teachSql, teacherCanTeach, canAccessEleve, pad, anneeDebut } = require('../util');
const config = require('../config');
const A = require('../services/absences');
const V = require('../services/validate');
const { verifierQuota } = require('../services/quotas');
const { genererEmailEleve } = require('../services/emailEleve');
const { assurerTarifsAnnee, historiser } = require('../services/tarifs');
const { photoExiste, removeFile, imageUpload, imageValide } = require('../services/storage');
const express = require('express');
const { allow } = require('../auth');
const { ah } = require('../util');
const { audit } = require('../audit');

const STAFF = ['admin', 'enseignant', 'comptable'];
const ALL = ['admin', 'enseignant', 'comptable', 'parent', 'eleve'];
const CLASSE_NOM = (a) => `${a}.niveau||COALESCE(' '||${a}.section,'')`;
const refCount = (sql) => `SELECT COUNT(*) n FROM ${sql}`;

// ---------- Utilisateurs (admin, enseignants, parents, comptables, élèves) ----------
const users = crud({
  table: 'users', read: ['admin', 'comptable'], write: ['admin'],
  fields: ['email', 'nom', 'prenom', 'role', 'telephone', 'specialite', 'actif'],
  required: ['email', 'nom', 'prenom', 'role'], filters: ['role'], searchFields: ['t.nom', 't.prenom', 't.email'],
  columns: `t.id,t.email,t.role,t.nom,t.prenom,t.telephone,t.specialite,t.actif,t.created_at,t.nom||' '||t.prenom AS nom_complet`,
  order: 't.nom, t.prenom',
  scope: (u) => (u.role === 'comptable' ? "t.role='parent'" : null),
  async beforeSave({ data, body, isNew, old, user, client }) {
    if (isNew && data.role !== 'eleve') await verifierQuota(user.school_id, 'utilisateurs');
    checkTelephone(data.telephone);
    if (data.nom !== undefined) data.nom = V.nomPropre(data.nom, 'Le nom');
    if (data.prenom !== undefined) data.prenom = V.nomPropre(data.prenom, 'Le prénom');
    if (data.specialite !== undefined) data.specialite = V.texte(data.specialite, 'La spécialité', { max: 80, re: /^[\p{L}\p{N}][\p{L}\p{N}\p{M} '’.,&()/+-]*$/u, reMsg: 'La spécialité : caractères non autorisés' });
    if (isNew || data.email !== undefined) {
      data.email = V.email(data.email);
      if ((await client.query('SELECT 1 FROM users WHERE email=$1 AND id<>$2', [data.email, old?.id || 0])).rowCount) throw new HttpError(409, 'Cette adresse e-mail est déjà utilisée');
    }
    if (data.role && !['admin', 'enseignant', 'parent', 'eleve', 'comptable'].includes(data.role)) throw new HttpError(400, 'Rôle invalide');
    if (isNew && !body.password) throw new HttpError(400, 'Mot de passe obligatoire');
    if (body.password) {
      V.motDePasse(body.password);
      if (body.password_confirm !== undefined && body.password_confirm !== body.password) throw new HttpError(400, 'La confirmation du mot de passe ne correspond pas');
      data.password_hash = await bcrypt.hash(String(body.password), 12);
    }
    if (!isNew && old.id === user.id && (data.actif === false || (data.role && data.role !== old.role)))
      throw new HttpError(400, 'Vous ne pouvez pas désactiver votre compte ni modifier votre rôle');
    if (isNew && data.role === 'parent') data.consentement_rgpd_at = new Date();
  },
  deleteChecks: [
    { sql: refCount('affectations WHERE enseignant_id=$1 AND deleted_at IS NULL'), message: "Cet enseignant a des affectations matière/classe : supprimez-les d'abord." },
    { sql: refCount('classes WHERE titulaire_id=$1 AND deleted_at IS NULL'), message: 'Cet enseignant est titulaire d\'une classe : réaffectez la classe.' },
    { sql: refCount('creneaux WHERE enseignant_id=$1 AND deleted_at IS NULL'), message: "Cet enseignant a des créneaux d'emploi du temps." },
    { sql: refCount('eleve_parents WHERE parent_id=$1'), message: 'Ce parent est lié à des élèves. Supprimer quand même ? (les liens seront retirés)', force: true, onForce: 'DELETE FROM eleve_parents WHERE parent_id=$1' },
  ],
  beforeDelete({ user, old }) { if (user.id === old.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte'); },
});

// ---------- Classes ----------
const classes = crud({
  table: 'classes', fields: ['niveau', 'section', 'capacite', 'titulaire_id'], required: ['niveau'], annee: true,
  read: ALL, write: ['admin'], filters: ['niveau'], searchFields: ['t.niveau', 't.section'],
  from: 'classes t LEFT JOIN users u ON u.id=t.titulaire_id',
  columns: `t.*, ${CLASSE_NOM('t')} AS nom, u.nom||' '||u.prenom AS titulaire_nom,
            (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=t.id AND e.deleted_at IS NULL) AS effectif`,
  order: 't.niveau, t.section',
  scope: (u, p) => (u.role === 'parent'
    ? `t.id IN (SELECT e.classe_id FROM eleves e JOIN eleve_parents ep ON ep.eleve_id=e.id WHERE ep.parent_id=${p(u.id)})`
    : u.role === 'eleve' ? `t.id IN (SELECT classe_id FROM eleves WHERE user_id=${p(u.id)})` : null),
  async beforeSave({ data, merged, client, old }) {
    if (data.niveau !== undefined) V.choix(data.niveau, 'Le niveau', V.NIVEAUX, { required: true });
    if (data.section !== undefined) data.section = V.texte(data.section, 'La section', { max: 3, re: /^[A-Za-z0-9]+$/, reMsg: 'La section : 1 à 3 lettres ou chiffres' })?.toUpperCase() ?? null;
    if (data.capacite !== undefined) data.capacite = V.nombre(data.capacite, 'La capacité', { min: 1, max: 50, entier: true, required: true });
    const dup = await client.query("SELECT 1 FROM classes WHERE niveau=$1 AND COALESCE(section,'')=COALESCE($2,'') AND annee_scolaire=$3 AND deleted_at IS NULL AND id<>$4", [merged.niveau, 'section' in data ? data.section : merged.section ?? null, merged.annee_scolaire, old?.id || 0]);
    if (dup.rowCount) throw new HttpError(409, 'Cette classe existe déjà pour cette année scolaire');
    if (old && data.capacite !== undefined) {
      const n = Number((await client.query('SELECT COUNT(*) n FROM eleves WHERE classe_id=$1 AND deleted_at IS NULL', [old.id])).rows[0].n);
      if (data.capacite < n) throw new HttpError(400, `La capacité ne peut pas être inférieure à l'effectif actuel (${n} élèves)`);
    }
    if (data.titulaire_id) {
      const r = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='enseignant' AND deleted_at IS NULL", [data.titulaire_id]);
      if (!r.rowCount) throw new HttpError(400, 'Le titulaire doit être un enseignant');
    }
    if (merged.capacite !== undefined && Number(merged.capacite) < 1) throw new HttpError(400, 'Capacité invalide');
  },
  deleteChecks: [
    { sql: refCount('eleves WHERE classe_id=$1 AND deleted_at IS NULL'), message: 'Des élèves sont affectés à cette classe. Supprimer quand même ? (ils seront désaffectés)', force: true, onForce: 'UPDATE eleves SET classe_id=NULL WHERE classe_id=$1' },
    { sql: refCount('creneaux WHERE classe_id=$1 AND deleted_at IS NULL'), message: "Cette classe a des créneaux d'emploi du temps.", force: true, onForce: 'UPDATE creneaux SET deleted_at=now() WHERE classe_id=$1' },
    { sql: refCount('affectations WHERE classe_id=$1 AND deleted_at IS NULL'), message: 'Cette classe a des affectations enseignant.', force: true, onForce: 'UPDATE affectations SET deleted_at=now() WHERE classe_id=$1' },
    { sql: refCount('evaluations WHERE classe_id=$1 AND deleted_at IS NULL'), message: 'Cette classe a des évaluations : suppression impossible.' },
  ],
});

// ---------- Matières ----------
const matieres = crud({
  table: 'matieres', fields: ['nom', 'coefficient', 'niveau'], required: ['nom'], read: ALL, write: ['admin'],
  searchFields: ['t.nom'], order: 't.nom',
  async beforeSave({ data, merged, client, old }) {
    if (data.nom !== undefined) data.nom = V.libelle(data.nom, 'Le nom de la matière', { required: true, max: 60 });
    if (data.coefficient !== undefined) data.coefficient = V.nombre(data.coefficient, 'Le coefficient', { min: 0.5, max: 10, required: true });
    if (data.niveau !== undefined) data.niveau = V.choix(data.niveau, 'Le niveau', V.NIVEAUX);
    const dup = await client.query("SELECT 1 FROM matieres WHERE lower(nom)=lower($1) AND COALESCE(niveau,'')=COALESCE($2,'') AND deleted_at IS NULL AND id<>$3", [merged.nom, 'niveau' in data ? data.niveau : merged.niveau ?? null, old?.id || 0]);
    if (dup.rowCount) throw new HttpError(409, 'Cette matière existe déjà pour ce niveau');
  },
  deleteChecks: [
    { sql: refCount('notes n JOIN evaluations e ON e.id=n.evaluation_id WHERE e.matiere_id=$1 AND n.deleted_at IS NULL'), message: 'Des notes sont rattachées à cette matière : suppression impossible.' },
    { sql: refCount('affectations WHERE matiere_id=$1 AND deleted_at IS NULL'), message: 'Cette matière est affectée à des enseignants.' },
    { sql: refCount('creneaux WHERE matiere_id=$1 AND deleted_at IS NULL'), message: "Cette matière figure dans l'emploi du temps." },
    { sql: refCount('devoirs WHERE matiere_id=$1 AND deleted_at IS NULL'), message: 'Des devoirs sont rattachés à cette matière.' },
  ],
});

// ---------- Salles ----------
const salles = crud({
  table: 'salles', fields: ['nom', 'capacite', 'disponible'], required: ['nom'], read: STAFF, write: ['admin'],
  searchFields: ['t.nom'], order: 't.nom',
  async beforeSave({ data, merged, client, old }) {
    if (data.nom !== undefined) data.nom = V.libelle(data.nom, 'Le nom de la salle', { required: true, min: 1, max: 50 });
    if (data.capacite !== undefined) data.capacite = V.nombre(data.capacite, 'La capacité', { min: 1, max: 200, entier: true });
    if ((await client.query('SELECT 1 FROM salles WHERE lower(nom)=lower($1) AND deleted_at IS NULL AND id<>$2', [merged.nom, old?.id || 0])).rowCount) throw new HttpError(409, 'Une salle porte déjà ce nom');
  },
  deleteChecks: [{ sql: refCount('creneaux WHERE salle_id=$1 AND deleted_at IS NULL'), message: "Cette salle est utilisée dans l'emploi du temps." }],
});

// ---------- Affectations enseignant ↔ matière ↔ classe ----------
const affectations = crud({
  table: 'affectations', fields: ['enseignant_id', 'matiere_id', 'classe_id'], required: ['enseignant_id', 'matiere_id', 'classe_id'], annee: true,
  read: ['admin', 'enseignant'], write: ['admin'],
  from: 'affectations t JOIN users u ON u.id=t.enseignant_id JOIN matieres m ON m.id=t.matiere_id JOIN classes c ON c.id=t.classe_id',
  columns: `t.*, u.nom||' '||u.prenom AS enseignant_nom, m.nom AS matiere_nom, ${CLASSE_NOM('c')} AS classe_nom`,
  filters: ['enseignant_id', 'classe_id', 'matiere_id'], order: 'c.niveau, m.nom',
  async beforeSave({ merged, client, old }) {
    const ok = async (sql, id) => (await client.query(sql, [id])).rowCount > 0;
    if (!(await ok("SELECT 1 FROM users WHERE id=$1 AND role='enseignant' AND actif AND deleted_at IS NULL", merged.enseignant_id))) throw new HttpError(400, 'Enseignant invalide ou inactif');
    if (!(await ok('SELECT 1 FROM matieres WHERE id=$1 AND deleted_at IS NULL', merged.matiere_id))) throw new HttpError(400, 'Matière introuvable');
    if (!(await ok('SELECT 1 FROM classes WHERE id=$1 AND deleted_at IS NULL', merged.classe_id))) throw new HttpError(400, 'Classe introuvable');
    const dup = await client.query('SELECT 1 FROM affectations WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire=$4 AND deleted_at IS NULL AND id<>$5',
      [merged.enseignant_id, merged.matiere_id, merged.classe_id, merged.annee_scolaire, old?.id || 0]);
    if (dup.rowCount) throw new HttpError(409, 'Cette affectation existe déjà');
  },
});

// ---------- Élèves ----------
// Mot de passe du compte de connexion de l'élève : obligatoire (avec confirmation) à la création ; ensuite facultatif
// (vide = inchangé ; renseigné = remplace le mot de passe, ou crée le compte d'un ancien élève qui n'en avait pas).
function controlerMotDePasseEleve(body, { isNew }) {
  const pw = body.password; const conf = body.password_confirm;
  const vide = (v) => v === undefined || v === null || v === '';
  if (typeof pw === 'object' || typeof conf === 'object') throw new HttpError(400, 'Mot de passe invalide');
  if (vide(pw)) {
    if (isNew) throw new HttpError(400, 'Le mot de passe est obligatoire');
    if (!vide(conf)) throw new HttpError(400, 'Saisissez le mot de passe avant de le confirmer');
    return null;
  }
  if (vide(conf)) throw new HttpError(400, 'La confirmation du mot de passe est obligatoire');
  if (String(pw) !== String(conf)) throw new HttpError(400, 'La confirmation du mot de passe ne correspond pas');
  V.motDePasse(pw, 'Le mot de passe');
  return String(pw);
}
async function synchroniserCompteEleve({ client, user, old, data, merged, secret }) {
  const nom = data.nom ?? merged.nom; const prenom = data.prenom ?? merged.prenom; // valeurs déjà nettoyées par beforeSave
  if (old?.user_id) { // compte existant : nom/prénom suivent l'élève ; mot de passe remplacé seulement s'il est saisi
    if (secret && user.role !== 'admin') throw new HttpError(403, "Seul l'administrateur peut changer le mot de passe d'un compte existant");
    const hash = secret ? await bcrypt.hash(secret, 12) : null;
    await client.query('UPDATE users SET nom=$2, prenom=$3, password_hash=COALESCE($4, password_hash) WHERE id=$1', [old.user_id, nom, prenom, hash]);
    if (secret) await audit(client, user, 'password_reset', 'users', old.user_id, null, null);
    return;
  }
  if (!secret) return; // ancien élève sans compte et aucun mot de passe saisi : rien à créer
  const email = data.email ?? old?.email ?? merged.email;
  if (secret.toLowerCase() === String(email).toLowerCase()) throw new HttpError(400, "Le mot de passe ne doit pas être identique à l'e-mail");
  const u = (await client.query("INSERT INTO users(email,password_hash,role,nom,prenom) VALUES ($1,$2,'eleve',$3,$4) RETURNING id,email,role,nom,prenom,actif",
    [email, await bcrypt.hash(secret, 12), nom, prenom])).rows[0];
  await audit(client, user, 'create', 'users', u.id, null, u);
  data.user_id = u.id;
}
const eleves = crud({
  table: 'eleves', read: ALL, write: ['admin', 'comptable'],
  fields: ['matricule', 'nom', 'prenom', 'date_naissance', 'sexe', 'adresse', 'photo', 'antecedents_medicaux', 'annee_entree', 'classe_id', 'statut'], // user_id (compte de connexion) n'est jamais fourni par le client : il est créé et lié ici
  required: ['nom', 'prenom'], filters: ['classe_id', 'statut'], searchFields: ['t.nom', 't.prenom', 't.matricule'],
  from: 'eleves t LEFT JOIN classes c ON c.id=t.classe_id',
  columns: `t.*, ${CLASSE_NOM('c')} AS classe_nom, (SELECT COALESCE(array_agg(ep.parent_id),'{}'::int[]) FROM eleve_parents ep WHERE ep.eleve_id=t.id) AS parent_ids`,
  order: 't.nom, t.prenom',
  scope: (u, p) => eleveScope(p, u, 't.id'),
  async beforeSave({ data, merged, client, old, body, isNew, user }) {
    if (isNew) await verifierQuota(user.school_id, 'eleves');
    const secret = controlerMotDePasseEleve(body, { isNew });
    if (data.nom !== undefined) data.nom = V.nomPropre(data.nom, "Le nom de l'élève");
    if (data.prenom !== undefined) data.prenom = V.nomPropre(data.prenom, "Le prénom de l'élève");
    if (data.sexe !== undefined) data.sexe = V.choix(data.sexe, 'Le sexe', ['M', 'F']);
    if (data.statut !== undefined) V.choix(data.statut, 'Le statut', ['actif', 'inactif', 'diplome'], { required: true });
    if (data.adresse !== undefined) data.adresse = V.texte(data.adresse, "L'adresse", { max: 200 });
    if (data.antecedents_medicaux !== undefined) data.antecedents_medicaux = V.texte(data.antecedents_medicaux, 'Les antécédents médicaux', { max: 1000, multiligne: true });
    if (data.photo !== undefined) {
      data.photo = V.photo(data.photo, 'La photo');
      if (data.photo?.startsWith('/api/files/') && !photoExiste(data.photo.slice(11))) throw new HttpError(400, 'Photo introuvable : renvoyez-la');
    }
    if (data.annee_entree !== undefined) data.annee_entree = V.annee(data.annee_entree, "L'année d'entrée");
    if (data.matricule !== undefined) {
      data.matricule = V.texte(data.matricule, 'Le matricule', { max: 20, re: /^[A-Za-z0-9-]+$/, reMsg: 'Le matricule : lettres, chiffres et tirets uniquement' })?.toUpperCase() ?? null;
      if (data.matricule && (await client.query('SELECT 1 FROM eleves WHERE matricule=$1 AND deleted_at IS NULL AND id<>$2', [data.matricule, old?.id || 0])).rowCount) throw new HttpError(409, 'Ce matricule est déjà utilisé');
    }
    if (body.parent_ids !== undefined) {
      const ids = V.entiersId(body.parent_ids, 'Les parents', { max: 4 });
      body.parent_ids = ids;
      if (ids.length && (await client.query("SELECT COUNT(*) n FROM users WHERE id = ANY($1::int[]) AND role='parent' AND deleted_at IS NULL", [ids])).rows[0].n < ids.length) throw new HttpError(400, 'Un des parents sélectionnés est invalide');
    }
    if (data.date_naissance) checkNaissance(data.date_naissance);
    if (data.classe_id && (!old || String(old.classe_id) !== String(data.classe_id))) {
      const c = (await client.query('SELECT capacite, (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=c.id AND e.deleted_at IS NULL AND e.id<>$2) AS n FROM classes c WHERE c.id=$1 AND c.deleted_at IS NULL', [data.classe_id, old ? old.id : 0])).rows[0];
      if (!c) throw new HttpError(400, 'Classe introuvable');
      if (c.n >= c.capacite) throw new HttpError(409, `Capacité maximale de la classe atteinte (${c.capacite})`);
    }
    if (!merged.annee_entree && !old) data.annee_entree = config.anneeCourante;
    // E-mail : toujours généré par le serveur (jamais saisi), unique ; conservé tel quel pour un élève qui en a déjà un
    if (!old?.email) data.email = await genererEmailEleve({ nom: merged.nom, prenom: merged.prenom, date_naissance: merged.date_naissance, exceptEleveId: old?.id || 0 });
    // Compte de connexion : créé automatiquement (e-mail de l'élève = identifiant, mot de passe haché bcrypt), ou mis à jour
    await synchroniserCompteEleve({ client, user, old, data, merged, secret });
  },
  beforeDelete({ client, old }) {
    // Un élève supprimé ne doit plus pouvoir se connecter (le compte est désactivé, pas détruit : l'historique reste lisible)
    return old.user_id ? client.query('UPDATE users SET actif=FALSE WHERE id=$1', [old.user_id]) : null;
  },
  async afterCommit({ row, old }) {
    if (old?.photo && old.photo !== row.photo && old.photo.startsWith('/api/files/')) await removeFile(old.photo.slice(11));
  },
  async afterSave({ client, row, body, isNew }) {
    if (isNew && !row.matricule) {
      await client.query('UPDATE eleves SET matricule=$1 WHERE id=$2', [`E${anneeDebut(row.annee_entree || config.anneeCourante)}${pad(row.id, 4)}`, row.id]);
    }
    if (Array.isArray(body.parent_ids)) {
      await client.query('DELETE FROM eleve_parents WHERE eleve_id=$1', [row.id]);
      for (const pid of body.parent_ids) await client.query("INSERT INTO eleve_parents(eleve_id,parent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [row.id, pid]);
    }
  },
});

// ---------- Tarifs ----------
// Scolarité : un prix par niveau et par année (+50 DT automatiques chaque année). Toute modification est historisée.
const tarifs = crud({
  table: 'tarifs', fields: ['libelle', 'type', 'niveau', 'montant', 'echeance'], required: ['libelle', 'montant'], annee: true, filters: ['type', 'niveau'],
  read: ['admin', 'comptable'], write: ['admin', 'comptable'], order: 't.type, t.niveau NULLS LAST, t.echeance NULLS LAST, t.id',
  async beforeSave({ data, merged, client, old }) {
    if (data.libelle !== undefined) data.libelle = V.libelle(data.libelle, 'Le libellé', { required: true });
    if (data.type !== undefined) V.choix(data.type, 'Le type', ['inscription', 'scolarite', 'tranche', 'autre'], { required: true });
    if (data.niveau !== undefined) data.niveau = V.choix(data.niveau, 'Le niveau', V.NIVEAUX);
    if (data.montant !== undefined) data.montant = V.nombre(data.montant, 'Le montant', { min: 0.01, max: 100000, required: true });
    if (data.echeance !== undefined) { const b = V.bornesAnnee(merged.annee_scolaire); data.echeance = V.date(data.echeance, "L'échéance", { min: b.debut, max: b.fin }); }
    const niveau = 'niveau' in data ? data.niveau : merged.niveau;
    const type = data.type ?? merged.type;
    if (type === 'scolarite') {
      if (!niveau) throw new HttpError(400, 'La scolarité doit être rattachée à un niveau : chaque niveau a son propre prix');
      const dup = await client.query("SELECT 1 FROM tarifs WHERE type='scolarite' AND niveau=$1 AND annee_scolaire=$2 AND deleted_at IS NULL AND id<>$3", [niveau, merged.annee_scolaire, old?.id || 0]);
      if (dup.rowCount) throw new HttpError(409, `Le tarif de scolarité « ${niveau} » existe déjà pour ${merged.annee_scolaire} : modifiez-le.`);
    }
  },
  async afterSave({ client, row, old, isNew, user }) {
    if (isNew) await historiser(client, { tarif: row, nouveau: row.montant, motif: 'creation', userId: user.id });
    else if (Number(old.montant) !== Number(row.montant)) await historiser(client, { tarif: row, ancien: old.montant, nouveau: row.montant, motif: 'modification', userId: user.id });
  },
  async beforeDelete({ client, old, user }) { await historiser(client, { tarif: old, ancien: old.montant, motif: 'suppression', userId: user.id }); },
  deleteChecks: [{ sql: refCount('paiements WHERE tarif_id=$1 AND deleted_at IS NULL'), message: 'Des paiements sont liés à ce tarif.' }],
});
// Routes annexes (montées AVANT le CRUD) : génération automatique à l'ouverture d'une année, historique
const tarifsExtra = express.Router();
tarifsExtra.get('/', allow('admin', 'comptable'), ah(async (req, _res, next) => { if (req.query.annee !== 'all') await assurerTarifsAnnee(req.query.annee || config.anneeCourante); next(); }));
tarifsExtra.post('/generer', allow('admin', 'comptable'), ah(async (req, res) => {
  const annee = V.annee(req.body?.annee) || config.anneeCourante;
  const crees = await assurerTarifsAnnee(annee, { force: true });
  res.json({ annee, crees: crees.length });
}));
tarifsExtra.get('/historique', allow('admin', 'comptable'), ah(async (req, res) => {
  const params = []; const where = [];
  if (req.query.niveau) { params.push(String(req.query.niveau)); where.push(`h.niveau=$${params.length}`); }
  const { rows } = await q(`SELECT h.*, u.nom||' '||u.prenom AS utilisateur FROM tarifs_historique h LEFT JOIN users u ON u.id=h.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY h.id DESC LIMIT 500`, params);
  res.json(rows);
}));

// ---------- Photo d'élève (envoi depuis le PC ou capture caméra) ----------
const elevesPhoto = express.Router();
// Aperçu de l'e-mail qui sera attribué (l'adresse définitive est toujours recalculée à l'enregistrement)
elevesPhoto.get('/email-suggestion', allow('admin', 'comptable'), ah(async (req, res) => {
  const nom = V.nomPropre(req.query.nom, 'Le nom'); const prenom = V.nomPropre(req.query.prenom, 'Le prénom');
  res.json({ email: await genererEmailEleve({ nom, prenom, date_naissance: req.query.date_naissance }) });
}));
elevesPhoto.post('/photo', allow('admin', 'comptable'), imageUpload.single('photo'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Aucune image reçue');
  if (!imageValide(req.file)) throw new HttpError(400, "Ce fichier n'est pas une image valide");
  res.status(201).json({ photo: `/api/files/${req.file.filename}` });
}));

// ---------- Évaluations ----------
const evaluations = crud({
  table: 'evaluations', fields: ['classe_id', 'matiere_id', 'titre', 'type', 'trimestre', 'date_eval', 'bareme'], required: ['classe_id', 'matiere_id', 'titre'], annee: true,
  read: ['admin', 'enseignant'], write: ['admin', 'enseignant'], filters: ['classe_id', 'matiere_id', 'trimestre'],
  from: 'evaluations t JOIN classes c ON c.id=t.classe_id JOIN matieres m ON m.id=t.matiere_id',
  columns: `t.*, ${CLASSE_NOM('c')} AS classe_nom, m.nom AS matiere_nom, (SELECT COUNT(*) FROM notes n WHERE n.evaluation_id=t.id AND n.deleted_at IS NULL) AS nb_notes`,
  order: 't.date_eval DESC NULLS LAST, t.id DESC',
  scope: (u, p) => (u.role === 'enseignant' ? teachSql(p, u, 't.classe_id', 't.matiere_id') : null),
  async beforeSave({ merged, data, user, isNew, old, client }) {
    if (data.titre !== undefined) data.titre = V.libelle(data.titre, 'Le titre', { required: true });
    if (data.type !== undefined) V.choix(data.type, 'Le type', ['controle_continu', 'examen_trimestriel'], { required: true });
    if (data.trimestre !== undefined) data.trimestre = V.nombre(data.trimestre, 'Le trimestre', { min: 1, max: 3, entier: true, required: true });
    if (data.bareme !== undefined) {
      data.bareme = V.nombre(data.bareme, 'Le barème', { min: 1, max: 100, required: true });
      if (old) {
        const max = (await client.query('SELECT MAX(valeur) m FROM notes WHERE evaluation_id=$1 AND deleted_at IS NULL', [old.id])).rows[0].m;
        if (max !== null && data.bareme < Number(max)) throw new HttpError(400, `Le barème ne peut pas être inférieur à la plus haute note déjà saisie (${max})`);
      }
    }
    if (data.date_eval !== undefined) { const b = V.bornesAnnee(merged.annee_scolaire); data.date_eval = V.date(data.date_eval, "La date de l'évaluation", { min: b.debut, max: b.fin }); }
    if (!(await teacherCanTeach(user, merged.classe_id, merged.matiere_id))) throw new HttpError(403, "Vous n'enseignez pas cette matière dans cette classe");
    if (isNew) data.created_by = user.id;
  },
  async beforeDelete({ user, old }) {
    if (!(await teacherCanTeach(user, old.classe_id, old.matiere_id))) throw new HttpError(403, 'Accès refusé');
  },
  deleteChecks: [{ sql: refCount('notes WHERE evaluation_id=$1 AND deleted_at IS NULL'), message: 'Cette évaluation contient des notes. Supprimer quand même ? (les notes seront supprimées)', force: true, onForce: 'UPDATE notes SET deleted_at=now() WHERE evaluation_id=$1' }],
});

// ---------- Absences ----------
const absences = crud({
  table: 'absences', fields: ['eleve_id', 'date_absence', 'periode', 'motif', 'justifiee', 'justification'], required: ['eleve_id', 'date_absence'], annee: true,
  read: ['admin', 'enseignant', 'parent', 'eleve'], write: ['admin', 'enseignant'], filters: ['eleve_id', 'justifiee'],
  from: 'absences t JOIN eleves e ON e.id=t.eleve_id', columns: `t.*, e.nom||' '||e.prenom AS eleve_nom`, order: 't.date_absence DESC',
  scope: (u, p) => eleveScope(p, u, 't.eleve_id'),
  async beforeSave({ data, merged, old, isNew, user, client }) {
    // Élève : accessible, actif et inscrit dans une classe
    if (!(await canAccessEleve(user, merged.eleve_id))) throw new HttpError(403, "Cet élève n'est pas dans vos classes");
    if (isNew || data.eleve_id !== undefined) await A.checkEleveActif(client, merged.eleve_id);
    // Une absence déjà justifiée par un parent ne peut être modifiée que par l'administrateur
    if (old?.justifiee && user.role !== 'admin') throw new HttpError(403, "Absence déjà justifiée : seul l'administrateur peut la modifier");
    // Date : valide, pas dans le futur, pas un dimanche, dans l'année scolaire, rétroactivité limitée pour l'enseignant
    const dateIso = A.normDate(merged.date_absence);
    if (isNew || data.date_absence !== undefined) data.date_absence = A.checkDateAbsence(merged.date_absence, { user, annee: merged.annee_scolaire || config.anneeCourante });
    // Période, motif et justification
    if (isNew || data.periode !== undefined) data.periode = A.checkPeriode(merged.periode || 'journee');
    if (data.motif !== undefined) data.motif = A.checkMotif(data.motif);
    if (data.justification !== undefined) data.justification = A.checkJustification(data.justification);
    // Seul l'administrateur (ou le parent, via « Justifier ») peut justifier une absence
    if (user.role !== 'admin' && ((data.justifiee !== undefined && !!data.justifiee !== !!old?.justifiee) || (data.justification !== undefined && data.justification !== (old?.justification ?? null))))
      throw new HttpError(403, "Seuls l'administrateur et le parent peuvent justifier une absence");
    if (merged.justifiee && !(data.justification ?? merged.justification))
      throw new HttpError(400, 'Une justification est obligatoire pour une absence justifiée');
    // Une seule absence par élève et par jour
    await A.checkDoublon(client, merged.eleve_id, dateIso, old?.id);
  },
  async afterCommit({ row, isNew }) { if (isNew && !row.justifiee) await A.notifierAbsence(row); },
  async beforeDelete({ user, old }) {
    if (old.justifiee && user.role !== 'admin') throw new HttpError(403, "Absence déjà justifiée : seul l'administrateur peut la supprimer");
  },
});

module.exports = { tarifsExtra, elevesPhoto, users, classes, matieres, salles, affectations, eleves, tarifs, evaluations, absences };

// Espace du propriétaire de la plateforme : gestion des écoles (réservé au rôle « superadmin »).
// Ces requêtes utilisent le pool « propriétaire » (qa/txa) : elles ne lisent aucune donnée d'élève, uniquement les écoles et leurs comptes de direction.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { qa, txa } = require('../db');
const { allow } = require('../auth');
const { ah, HttpError } = require('../util');
const V = require('../services/validate');
const { slugify } = require('../migrate');

const r = express.Router();
r.use(allow('superadmin'));

const PLANS = ['basic', 'standard', 'premium'];
const STATUTS = ['trial', 'active', 'suspended'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const journal = (userId, schoolId, action, anciennes, nouvelles) =>
  qa('INSERT INTO audit_log(school_id,user_id,action,entite,entite_id,anciennes,nouvelles) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [schoolId, userId, action, 'schools', schoolId, anciennes ? JSON.stringify(anciennes) : null, nouvelles ? JSON.stringify(nouvelles) : null]).catch(() => {});

r.get('/schools', ah(async (_req, res) => {
  const { rows } = await qa(
    `SELECT s.*,
       (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id AND u.deleted_at IS NULL) AS nb_utilisateurs,
       (SELECT COUNT(*) FROM eleves e WHERE e.school_id=s.id AND e.deleted_at IS NULL) AS nb_eleves
     FROM schools s ORDER BY s.id`);
  res.json(rows);
}));

r.post('/schools', ah(async (req, res) => {
  const b = req.body || {};
  const nom = V.libelle(b.nom, "Le nom de l'école", { required: true, max: 120 });
  let slug = b.slug ? String(b.slug).trim().toLowerCase() : slugify(nom);
  if (!SLUG_RE.test(slug)) throw new HttpError(400, "L'identifiant (slug) : lettres minuscules, chiffres et tirets (40 caractères maximum)");
  const plan = V.choix(b.plan || 'basic', 'La formule', PLANS, { required: true });
  const status = V.choix(b.status || 'trial', 'Le statut', ['trial', 'active'], { required: true });
  const fin = V.date(b.subscription_end, "La fin d'abonnement", { min: V.aujourdhui() });
  const a = b.admin || {};
  const email = V.email(a.email, "L'e-mail de la direction");
  const adminNom = V.nomPropre(a.nom || 'Direction', 'Le nom de la direction');
  const adminPrenom = V.nomPropre(a.prenom || 'École', 'Le prénom de la direction');
  const genere = !a.password;
  const motDePasse = genere ? crypto.randomBytes(9).toString('base64url') : V.motDePasse(a.password, 'Le mot de passe de la direction');
  if ((await qa('SELECT 1 FROM users WHERE email=$1', [email])).rowCount) throw new HttpError(409, 'Cette adresse e-mail est déjà utilisée');
  if (!b.slug) { for (let i = 2; (await qa('SELECT 1 FROM schools WHERE slug=$1', [slug])).rowCount; i++) slug = `${slugify(nom).slice(0, 36)}-${i}`; }
  else if ((await qa('SELECT 1 FROM schools WHERE slug=$1', [slug])).rowCount) throw new HttpError(409, 'Cet identifiant est déjà utilisé');
  const hash = await bcrypt.hash(motDePasse, 12);
  const ecole = await txa(async (cl) => {
    const s = (await cl.query('INSERT INTO schools(nom,slug,status,plan,subscription_end) VALUES ($1,$2,$3,$4,$5) RETURNING *', [nom, slug, status, plan, fin])).rows[0];
    await cl.query("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'admin',$3,$4,$5)", [email, hash, adminNom, adminPrenom, s.id]);
    return s;
  });
  await journal(req.user.id, ecole.id, 'create', null, ecole);
  res.status(201).json({ ...ecole, admin_email: email, ...(genere ? { mot_de_passe_initial: motDePasse } : {}) });
}));

r.put('/schools/:id(\\d+)', ah(async (req, res) => {
  const old = (await qa('SELECT * FROM schools WHERE id=$1', [req.params.id])).rows[0];
  if (!old) throw new HttpError(404, 'École introuvable');
  const b = req.body || {}; const d = {};
  if (b.nom !== undefined) d.nom = V.libelle(b.nom, "Le nom de l'école", { required: true, max: 120 });
  if (b.status !== undefined) d.status = V.choix(b.status, 'Le statut', STATUTS, { required: true });
  if (b.plan !== undefined) d.plan = V.choix(b.plan, 'La formule', PLANS, { required: true });
  if (b.subscription_end !== undefined) d.subscription_end = V.date(b.subscription_end, "La fin d'abonnement");
  const cols = Object.keys(d);
  if (!cols.length) throw new HttpError(400, 'Aucune modification');
  const n = (await qa(`UPDATE schools SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map((c) => d[c]), old.id])).rows[0];
  await journal(req.user.id, old.id, 'update', old, n);
  res.json(n);
}));

module.exports = r;

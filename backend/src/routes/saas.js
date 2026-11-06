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
const { listerEcoles, norm } = require('../services/ecoles');

const r = express.Router();
r.use(allow('superadmin'));

const PLANS = ['basic', 'standard', 'premium'];
const STATUTS = ['trial', 'active', 'suspended'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const journal = (userId, schoolId, action, anciennes, nouvelles) =>
  qa('INSERT INTO audit_log(school_id,user_id,action,entite,entite_id,anciennes,nouvelles) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [schoolId, userId, action, 'schools', schoolId, anciennes ? JSON.stringify(anciennes) : null, nouvelles ? JSON.stringify(nouvelles) : null]).catch(() => {});

// Même source que la liste publique (services/ecoles.js) : mêmes libellés, même ordre ; ici toutes les écoles, avec détails.
r.get('/schools', ah(async (_req, res) => res.json(await listerEcoles({ complet: true }))));

// Coordonnées de l'école (facultatives côté API ; la ville est obligatoire dans le formulaire) : mêmes contrôles à la création et à la modification
function coordonnees(b, { complet }) {
  const d = {}; const a = (k) => complet || b[k] !== undefined;
  if (a('ville')) d.ville = V.texte(b.ville, 'La ville', { min: 2, max: 60, re: /^\p{L}[\p{L}\p{M} '’.-]*$/u, reMsg: 'La ville : lettres, espaces, apostrophes et tirets uniquement' });
  if (a('adresse')) d.adresse = V.texte(b.adresse, "L'adresse", { max: 200 });
  if (a('telephone')) {
    const t = V.texte(b.telephone, 'Le téléphone', { max: 20 });
    const chiffres = t ? t.replace(/[\s.-]/g, '') : null;
    if (chiffres && !/^\d{8}$/.test(chiffres)) throw new HttpError(400, 'Le téléphone : 8 chiffres (ex. 71 245 300)');
    d.telephone = chiffres ? `${chiffres.slice(0, 2)} ${chiffres.slice(2, 5)} ${chiffres.slice(5)}` : null;
  }
  if (a('email_contact')) d.email_contact = V.texte(b.email_contact, "L'e-mail de contact", { max: 120 }) ? V.email(b.email_contact, "L'e-mail de contact") : null;
  return d;
}
// Deux écoles ne peuvent pas porter le même nom dans la même ville (accents et majuscules ignorés)
async function verifierNomUnique(nom, ville, exceptId = 0) {
  const { rows } = await qa('SELECT id, nom, ville FROM schools WHERE id<>$1', [exceptId]);
  if (rows.some((x) => norm(x.nom) === norm(nom) && norm(x.ville) === norm(ville)))
    throw new HttpError(409, `Une école nommée « ${nom} »${ville ? ` existe déjà à ${ville}` : ' existe déjà'} : modifiez le nom ou la ville pour les distinguer.`);
}

r.post('/schools', ah(async (req, res) => {
  const b = req.body || {};
  const nom = V.libelle(b.nom, "Le nom de l'école", { required: true, max: 120 });
  let slug = b.slug ? String(b.slug).trim().toLowerCase() : slugify(nom);
  if (!SLUG_RE.test(slug)) throw new HttpError(400, "L'identifiant (slug) : lettres minuscules, chiffres et tirets (40 caractères maximum)");
  const plan = V.choix(b.plan || 'basic', 'La formule', PLANS, { required: true });
  const status = V.choix(b.status || 'trial', 'Le statut', ['trial', 'active'], { required: true });
  const fin = V.date(b.subscription_end, "La fin d'abonnement", { min: V.aujourdhui() });
  const coord = coordonnees(b, { complet: true });
  await verifierNomUnique(nom, coord.ville);
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
    const s = (await cl.query('INSERT INTO schools(nom,slug,status,plan,subscription_end,ville,adresse,telephone,email_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [nom, slug, status, plan, fin, coord.ville, coord.adresse, coord.telephone, coord.email_contact])).rows[0];
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
  Object.assign(d, coordonnees(b, { complet: false }));
  if (d.nom !== undefined || d.ville !== undefined) await verifierNomUnique(d.nom ?? old.nom, d.ville !== undefined ? d.ville : old.ville, old.id);
  const cols = Object.keys(d);
  if (!cols.length) throw new HttpError(400, 'Aucune modification');
  const n = (await qa(`UPDATE schools SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map((c) => d[c]), old.id])).rows[0];
  await journal(req.user.id, old.id, 'update', old, n);
  res.json(n);
}));

module.exports = r;

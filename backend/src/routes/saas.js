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
const L = require('../services/loyers');
const { profilUpload, removePlatformFile, imageValide } = require('../services/storage');

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
  if (a('site')) d.site = V.texte(b.site, 'Le site', { max: 80 });
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
  const debut = V.date(b.subscription_start, "Le début d'abonnement") || V.aujourdhui();
  const fin = V.date(b.subscription_end, "La fin d'abonnement", { min: V.aujourdhui() });
  if (fin && fin < debut) throw new HttpError(400, "La fin d'abonnement doit suivre le début d'abonnement");
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
    const s = (await cl.query('INSERT INTO schools(nom,slug,status,plan,subscription_start,subscription_end,ville,adresse,telephone,email_contact,site) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [nom, slug, status, plan, debut, fin, coord.ville, coord.adresse, coord.telephone, coord.email_contact, coord.site || null])).rows[0];
    await cl.query("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'admin',$3,$4,$5)", [email, hash, adminNom, adminPrenom, s.id]);
    return s;
  });
  if (b.contrat) {
    try { await L.enregistrerContrat(ecole.id, b.contrat); } catch (e) { await journal(req.user.id, ecole.id, 'contrat_refuse', null, { erreur: e.message }); return res.status(201).json({ ...ecole, admin_email: email, ...(genere ? { mot_de_passe_initial: motDePasse } : {}), contrat_erreur: e.message }); }
  }
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
  if (b.subscription_start !== undefined) d.subscription_start = V.date(b.subscription_start, "Le début d'abonnement", { required: true });
  if (b.subscription_end !== undefined) d.subscription_end = V.date(b.subscription_end, "La fin d'abonnement");
  if ((d.subscription_start !== undefined || d.subscription_end !== undefined)) {
    const debut = d.subscription_start ?? (old.subscription_start && String(old.subscription_start).slice(0, 10)); const fin = d.subscription_end !== undefined ? d.subscription_end : (old.subscription_end && String(old.subscription_end).slice(0, 10));
    if (debut && fin && fin < debut) throw new HttpError(400, "La fin d'abonnement doit suivre le début d'abonnement");
  }
  Object.assign(d, coordonnees(b, { complet: false }));
  if (d.nom !== undefined || d.ville !== undefined) await verifierNomUnique(d.nom ?? old.nom, d.ville !== undefined ? d.ville : old.ville, old.id);
  const cols = Object.keys(d);
  if (!cols.length) throw new HttpError(400, 'Aucune modification');
  const n = (await qa(`UPDATE schools SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map((c) => d[c]), old.id])).rows[0];
  await journal(req.user.id, old.id, 'update', old, n);
  res.json(n);
}));

// ---------- Accueil du propriétaire : totaux + indicateurs ----------
r.get('/accueil', ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const ecoles = await listerEcoles({ complet: true });
  const [roles, eleves, fin] = await Promise.all([
    qa("SELECT school_id, role, COUNT(*)::int n FROM users WHERE deleted_at IS NULL AND school_id IS NOT NULL GROUP BY 1,2"),
    qa("SELECT school_id, COUNT(*)::int n FROM eleves WHERE deleted_at IS NULL GROUP BY 1"),
    L.statistiques({ annee: Number(V.aujourdhui().slice(0, 4)) }),
  ]);
  const nb = (sid, role) => roles.rows.find((x) => x.school_id === sid && x.role === role)?.n || 0;
  const lignes = ecoles.map((s) => ({
    id: s.id, label: s.label, ville: s.ville, status: s.status, plan: s.plan, ouverte: s.ouverte, subscription_end: s.subscription_end,
    eleves: eleves.rows.find((x) => x.school_id === s.id)?.n || 0, enseignants: nb(s.id, 'enseignant'), parents: nb(s.id, 'parent'),
    loyer_mensuel: fin.par_ecole.find((p) => p.school_id === s.id)?.loyer_mensuel ?? null,
    echeances_en_retard: fin.par_ecole.find((p) => p.school_id === s.id)?.echeances_en_retard ?? 0,
  }));
  const somme = (k) => lignes.reduce((t, x) => t + x[k], 0);
  const mois = Number(V.aujourdhui().slice(5, 7));
  res.json({
    totaux: { ecoles: lignes.length, actives: lignes.filter((x) => x.status === 'active').length, suspendues: lignes.filter((x) => x.status === 'suspended').length, essai: lignes.filter((x) => x.status === 'trial').length,
      eleves: somme('eleves'), enseignants: somme('enseignants'), parents: somme('parents') },
    finance: { encaisse_mois: fin.mensuel[mois - 1].encaisse, prevu_mois: fin.mensuel[mois - 1].prevu, encaisse_annee: fin.totaux.encaisse, impaye: fin.totaux.impaye, nb_retards: fin.totaux.nb_en_retard, loyer_mensuel_total: fin.totaux.loyer_mensuel_total },
    prochaines: fin.prochaines.slice(0, 5), retards: fin.retards.slice(0, 5), ecoles: lignes,
  });
}));

// ---------- Nouveau tableau de bord (page « Accueil ») : tout est calculé en base à chaque appel ----------
// Utilisateurs = comptes rattachés à une école (directeurs, comptables, enseignants, parents, comptes élèves), hors super-administrateur.
// École « active » = école ouverte (statut Actif ou Essai, abonnement non expiré) ; « inactive » = suspendue ou abonnement expiré.
const ROLES_DASH = [['admin', 'Administrateurs'], ['comptable', 'Comptables'], ['enseignant', 'Enseignants'], ['parent', 'Parents'], ['eleve', 'Élèves']];
r.get('/dashboard', ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const [ecoles, comptes] = await Promise.all([
    listerEcoles({ complet: true }),
    qa("SELECT school_id, role, COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND school_id IS NOT NULL GROUP BY 1,2"),
  ]);
  const lignes = ecoles.map((s) => {
    const par_role = Object.fromEntries(ROLES_DASH.map(([k]) => [k, comptes.rows.find((x) => x.school_id === s.id && x.role === k)?.n || 0]));
    return { id: s.id, nom: s.nom, ville: s.ville, label: s.label, status: s.status, ouverte: s.ouverte, par_role, utilisateurs: Object.values(par_role).reduce((t, n) => t + n, 0) };
  });
  const parRole = ROLES_DASH.map(([k, label]) => ({ role: k, label, n: lignes.reduce((t, l) => t + l.par_role[k], 0) }));
  res.json({
    genere_le: new Date().toISOString(),
    totaux: {
      ecoles: lignes.length,
      utilisateurs: lignes.reduce((t, l) => t + l.utilisateurs, 0),
      ecoles_actives: lignes.filter((l) => l.ouverte).length,
      ecoles_inactives: lignes.filter((l) => !l.ouverte).length,
      dont_essai: lignes.filter((l) => l.ouverte && l.status === 'trial').length,
      dont_suspendues: lignes.filter((l) => l.status === 'suspended').length,
      dont_expirees: lignes.filter((l) => l.status !== 'suspended' && !l.ouverte).length,
    },
    roles: parRole,
    ecoles: lignes.sort((a, b) => b.utilisateurs - a.utilisateurs || a.label.localeCompare(b.label, 'fr')),
  });
}));

// ---------- Mon profil (super-administrateur) ----------
// Le mot de passe se change avec POST /api/auth/change-password (déjà existant : ancien mot de passe exigé, confirmation, hachage bcrypt).
const colonnesProfil = 'id, email, nom, prenom, telephone, photo, created_at';
r.get('/profil', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json((await qa(`SELECT ${colonnesProfil} FROM users WHERE id=$1`, [req.user.id])).rows[0]);
}));
r.put('/profil', ah(async (req, res) => {
  const b = req.body || {};
  const moi = (await qa('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  const d = {};
  if (b.nom !== undefined) d.nom = V.nomPropre(b.nom, 'Le nom');
  if (b.prenom !== undefined) d.prenom = V.nomPropre(b.prenom, 'Le prénom');
  if (b.telephone !== undefined) {
    const t = b.telephone === null || String(b.telephone).trim() === '' ? null : String(b.telephone).replace(/[\s.-]/g, '');
    if (t && !/^\d{8}$/.test(t)) throw new HttpError(400, 'Le téléphone doit contenir exactement 8 chiffres');
    d.telephone = t;
  }
  if (b.email !== undefined) {
    const email = V.email(b.email, "L'adresse e-mail");
    if (email !== moi.email) {
      // Changer l'identifiant de connexion exige le mot de passe actuel (une session volée ne suffit pas à prendre le compte)
      if (typeof b.mot_de_passe_actuel !== 'string' || !(await bcrypt.compare(b.mot_de_passe_actuel, moi.password_hash))) throw new HttpError(400, 'Mot de passe actuel requis et correct pour modifier l\'adresse e-mail');
      if ((await qa('SELECT 1 FROM users WHERE email=$1 AND id<>$2', [email, moi.id])).rowCount) throw new HttpError(409, 'Cette adresse e-mail est déjà utilisée');
      d.email = email;
    }
  }
  const cols = Object.keys(d);
  if (!cols.length) throw new HttpError(400, 'Aucune modification');
  const n = (await qa(`UPDATE users SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${cols.length + 1} RETURNING ${colonnesProfil}`, [...cols.map((c) => d[c]), moi.id])).rows[0];
  res.json(n);
}));
r.post('/profil/photo', profilUpload.single('photo'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Aucune photo reçue');
  if (!imageValide(req.file)) throw new HttpError(400, 'Fichier image invalide');
  const ancien = (await qa('SELECT photo FROM users WHERE id=$1', [req.user.id])).rows[0]?.photo;
  const n = (await qa(`UPDATE users SET photo=$1 WHERE id=$2 RETURNING ${colonnesProfil}`, [`/api/files/${req.file.filename}`, req.user.id])).rows[0];
  if (ancien?.startsWith('/api/files/')) await removePlatformFile(ancien.slice(11));
  res.json(n);
}));
r.delete('/profil/photo', ah(async (req, res) => {
  const ancien = (await qa('SELECT photo FROM users WHERE id=$1', [req.user.id])).rows[0]?.photo;
  const n = (await qa(`UPDATE users SET photo=NULL WHERE id=$1 RETURNING ${colonnesProfil}`, [req.user.id])).rows[0];
  if (ancien?.startsWith('/api/files/')) await removePlatformFile(ancien.slice(11));
  res.json(n);
}));

// ---------- Détail d'une école : informations + contrat + finances ----------
r.get('/schools/:id(\\d+)', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const e = (await listerEcoles({ complet: true })).find((x) => x.id === Number(req.params.id));
  if (!e) throw new HttpError(404, 'École introuvable');
  const contrat = (await qa('SELECT * FROM school_contracts WHERE school_id=$1', [e.id])).rows[0] || null;
  const comptes = (await qa("SELECT role, COUNT(*)::int n FROM users WHERE school_id=$1 AND deleted_at IS NULL GROUP BY role", [e.id])).rows;
  const classes = (await qa('SELECT COUNT(*)::int n FROM classes WHERE school_id=$1 AND deleted_at IS NULL', [e.id])).rows[0].n;
  const directeurs = (await qa("SELECT id, nom, prenom, email, actif FROM users WHERE school_id=$1 AND role='admin' AND deleted_at IS NULL ORDER BY nom", [e.id])).rows;
  const finance = contrat ? await L.statistiques({ ecoleId: e.id }) : null;
  res.json({ ecole: e, contrat, comptes: Object.fromEntries(comptes.map((c) => [c.role, c.n])), classes, directeurs, finance });
}));

// ---------- Contrat de location ----------
r.put('/schools/:id(\\d+)/contrat', ah(async (req, res) => {
  const e = (await qa('SELECT id FROM schools WHERE id=$1', [req.params.id])).rows[0];
  if (!e) throw new HttpError(404, 'École introuvable');
  const ancien = (await qa('SELECT * FROM school_contracts WHERE school_id=$1', [e.id])).rows[0] || null;
  const c = await L.enregistrerContrat(e.id, req.body);
  await journal(req.user.id, e.id, ancien ? 'contrat_update' : 'contrat_create', ancien, c);
  res.json(c);
}));

// ---------- Statistiques financières (filtres : école, année, mois) ----------
r.get('/finance/stats', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ecoleId = req.query.ecole_id ? V.nombre(req.query.ecole_id, "L'école", { min: 1, entier: true }) : null;
  const annee = req.query.annee ? V.nombre(req.query.annee, "L'année", { min: 2000, max: 2100, entier: true }) : Number(V.aujourdhui().slice(0, 4));
  const mois = req.query.mois ? V.nombre(req.query.mois, 'Le mois', { min: 1, max: 12, entier: true }) : null;
  const [stats, annees, ecoles] = await Promise.all([L.statistiques({ ecoleId, annee, mois }), L.annesDisponibles(), listerEcoles({ complet: true })]);
  res.json({ ...stats, annees, ecoles: ecoles.map((s) => ({ id: s.id, label: s.label })) });
}));

// ---------- Enregistrer un encaissement de loyer ----------
r.post('/echeances/:id(\\d+)/encaissements', ah(async (req, res) => {
  const p = await L.encaisser(Number(req.params.id), req.body || {}, req.user.id);
  await journal(req.user.id, p.school_id, 'loyer_encaisse', null, p);
  res.status(201).json(p);
}));

module.exports = r;

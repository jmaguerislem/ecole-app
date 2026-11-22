// Authentification, compte, notifications, push, RGPD, configuration, fichiers
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const { q, tx, qa, txa, runWith } = require('../db');
const { slugify } = require('../migrate');
const { sign, auth, allow, abonnementBloque } = require('../auth');
const { libelleEcole } = require('../libelle-ecole');
const { audit } = require('../audit');
const { ah, HttpError } = require('../util');
const config = require('../config');
const V = require('../services/validate');
const { definirMotDePasse, reinitialiser, envoyerCodeVerification, verifierEmail, notifierNouvelleEcole } = require('../services/invitations');
const { mailerDisponible } = require('../services/mailer');

const pub = express.Router(); // routes publiques
const priv = express.Router(); // routes authentifiées

// Configuration publique : le nom affiché est celui de l'école demandée (?ecole=slug), sinon le nom de la plateforme
pub.get('/config', ah(async (req, res) => {
  let nom = config.plateformeNom; let ville = null;
  if (req.query.ecole) {
    const s = (await qa('SELECT nom, ville FROM schools WHERE slug=$1', [String(req.query.ecole).slice(0, 60)])).rows[0];
    if (s) { nom = s.nom; ville = s.ville; }
  }
  res.json({ anneeCourante: config.anneeCourante, ecoleNom: nom, ecoleVille: ville, ecoleLabel: libelleEcole({ nom, ville }), vapidPublicKey: config.vapid?.pub || null });
}));

// Inscription libre-service d'une école : essai de 30 jours, formule Basic. (limitée par le rate-limit de /api/public)
pub.post('/public/signup', ah(async (req, res) => {
  const b = req.body || {};
  const nom = V.libelle(b.nom, "Le nom de l'école", { required: true, max: 120 });
  const email = V.email(b.email, "L'e-mail");
  const motDePasse = V.motDePasse(b.password, 'Le mot de passe');
  if (motDePasse.toLowerCase() === email) throw new HttpError(400, "Le mot de passe ne doit pas être identique à l'e-mail");
  // Vérification de l'adresse (code reçu par e-mail) : active dès qu'un SMTP est configuré. Sans envoi possible, l'inscription reste ouverte comme avant.
  const verification = config.verifierEmailInscription() && mailerDisponible();
  const hash = await bcrypt.hash(motDePasse, 12);
  // L'e-mail n'est unique que dans une école : une adresse déjà utilisée ailleurs ne bloque pas l'inscription d'une nouvelle école.
  // Une inscription jamais confirmée ne se connecte pas et ne contient aucune donnée : la même adresse peut la reprendre (évite qu'un tiers « réserve » l'adresse d'autrui)
  const existant = verification ? (await qa("SELECT id, school_id FROM users WHERE email=$1 AND email_a_verifier AND role='admin' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", [email])).rows[0] : null;
  const fin = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  let userId; let slug;
  if (existant) {
    await qa('UPDATE users SET password_hash=$2 WHERE id=$1', [existant.id, hash]);
    await qa('UPDATE schools SET nom=$2 WHERE id=$1', [existant.school_id, nom]);
    userId = existant.id; slug = (await qa('SELECT slug FROM schools WHERE id=$1', [existant.school_id])).rows[0].slug;
  } else {
    slug = slugify(nom);
    for (let i = 2; (await qa('SELECT 1 FROM schools WHERE slug=$1', [slug])).rowCount; i++) slug = `${slugify(nom).slice(0, 36)}-${i}`;
    userId = await txa(async (cl) => {
      const s = (await cl.query("INSERT INTO schools(nom,slug,status,plan,subscription_end) VALUES ($1,$2,'trial','basic',$3) RETURNING id", [nom, slug, fin])).rows[0];
      return (await cl.query("INSERT INTO users(email,password_hash,role,nom,prenom,school_id,email_a_verifier) VALUES ($1,$2,'admin','Direction','École',$3,$4) RETURNING id", [email, hash, s.id, verification])).rows[0].id;
    });
  }
  const rep = { ok: true, slug, essai_jusqu_au: fin };
  if (verification) { const r = await envoyerCodeVerification(userId); Object.assign(rep, { verification_requise: true, email_envoye: r.ok, ...(r.ok ? {} : { erreur: r.error }) }); }
  else await notifierNouvelleEcole(userId, { confirme: false }); // sans vérification d'e-mail : le super-administrateur est prévenu tout de suite (sinon, une fois l'adresse confirmée)
  res.status(201).json(rep);
}));

// Confirmation de l'adresse e-mail d'une école inscrite en libre-service (code reçu par e-mail), puis renvoi d'un nouveau code
pub.post('/public/verify-email', ah(async (req, res) => {
  const { email, code } = req.body || {};
  if ([email, code].some((v) => typeof v !== 'string' || !v.trim() || v.length > 200)) throw new HttpError(400, 'E-mail et code requis');
  res.json(await verifierEmail({ email, code }));
}));
pub.post('/public/resend-verification', ah(async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) throw new HttpError(400, 'Adresse e-mail invalide');
  const u = (await qa('SELECT id FROM users WHERE email=$1 AND email_a_verifier AND actif AND deleted_at IS NULL', [email.toLowerCase().trim()])).rows[0];
  if (u) await envoyerCodeVerification(u.id);
  res.json({ ok: true, message: 'Si une inscription est en attente pour cette adresse, un nouveau code vient d\'être envoyé.' }); // même réponse dans tous les cas
}));

// Réponse de connexion (jeton + profil public). `u` = ligne users + school_nom/slug/ville. Partagée avec la connexion de démonstration (routes/demo.js).
const reponseConnexion = (u) => ({
  token: sign(u),
  user: {
    id: u.id, email: u.email, role: u.role, nom: u.nom, prenom: u.prenom, telephone: u.telephone ?? null, photo: u.photo ?? null,
    must_change_password: !!u.must_change_password, // mot de passe temporaire : l'interface impose de le changer avant toute autre action
    school: u.school_id ? { id: u.school_id, nom: u.school_nom, slug: u.school_slug, ville: u.school_ville, label: libelleEcole({ nom: u.school_nom, ville: u.school_ville }) } : null,
  },
});

pub.post('/auth/login', ah(async (req, res) => {
  const { email, password, school } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'E-mail et mot de passe requis');
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 120 || password.length > 128) throw new HttpError(400, 'E-mail ou mot de passe invalide');
  if (school !== undefined && school !== null && (typeof school !== 'string' || school.length > 60)) throw new HttpError(400, 'École invalide');
  // Une même adresse peut exister dans plusieurs écoles (l'e-mail n'est unique que dans une école) : on retient les comptes dont le mot de passe correspond.
  // L'école n'est demandée que si plusieurs comptes correspondent à la fois (même adresse ET même mot de passe).
  const { rows } = await qa(
    `SELECT u.*, s.nom AS school_nom, s.slug AS school_slug, s.ville AS school_ville, s.status AS school_status, s.subscription_end
     FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.email=$1 AND u.deleted_at IS NULL AND u.actif ORDER BY u.id LIMIT 10`, [String(email).toLowerCase().trim()]);
  const PLATEFORME = '__plateforme'; // identifiant du compte propriétaire de la plateforme (sans école) dans le sélecteur
  const candidats = rows.filter((r) => !school || (r.school_slug || PLATEFORME) === school);
  const valides = [];
  for (const c of candidats) if (await bcrypt.compare(password, c.password_hash)) valides.push(c);
  if (!valides.length) throw new HttpError(401, 'Identifiants incorrects');
  if (valides.length > 1) throw new HttpError(409, 'Cette adresse est utilisée dans plusieurs écoles : choisissez votre école.', { code: 'school_required', ecoles: valides.map((c) => ({ slug: c.school_slug || PLATEFORME, nom: c.school_slug ? (c.school_ville ? `${c.school_nom} (${c.school_ville})` : c.school_nom) : 'Administration de la plateforme' })) });
  const u = valides[0];
  if (u.email_a_verifier) throw new HttpError(403, "Votre adresse e-mail n'est pas encore confirmée. Saisissez le code reçu par e-mail.", { code: 'email_not_verified' });
  if (u.role !== 'superadmin') {
    const refus = abonnementBloque({ status: u.school_status, subscription_end: u.subscription_end });
    if (refus) throw new HttpError(403, refus);
    await runWith({ schoolId: u.school_id, schoolNom: u.school_nom }, () => audit(null, u, 'login', 'users', u.id, null, null));
  }
  res.json(reponseConnexion(u));
}));

// Première connexion d'un parent (code reçu par e-mail) ou mot de passe oublié
pub.post('/auth/set-password', ah(async (req, res) => {
  const { email, code, password, confirmation } = req.body || {};
  if ([email, code, password].some((v) => typeof v !== 'string' || v.length > 200)) throw new HttpError(400, 'E-mail, code et mot de passe requis');
  if (confirmation !== undefined && confirmation !== password) throw new HttpError(400, 'La confirmation du mot de passe ne correspond pas');
  res.json(await definirMotDePasse({ email, code, password }));
}));
pub.post('/auth/forgot-password', ah(async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) throw new HttpError(400, 'Adresse e-mail invalide');
  await reinitialiser(email);
  res.json({ ok: true, message: 'Si un compte existe pour cette adresse, un e-mail contenant un code vient d\'être envoyé.' });
}));

priv.get('/auth/me', (req, res) => res.json({ ...req.user, school: req.school }));

priv.post('/auth/change-password', ah(async (req, res) => {
  const { ancien, nouveau, confirmation } = req.body || {};
  if (typeof ancien !== 'string' || ancien.length > 128) throw new HttpError(400, 'Ancien mot de passe invalide');
  V.motDePasse(nouveau, 'Le nouveau mot de passe');
  if (confirmation !== undefined && confirmation !== nouveau) throw new HttpError(400, 'La confirmation ne correspond pas au nouveau mot de passe');
  if (nouveau === ancien) throw new HttpError(400, "Le nouveau mot de passe doit être différent de l'ancien");
  if (nouveau.toLowerCase() === String(req.user.email).toLowerCase()) throw new HttpError(400, "Le mot de passe ne doit pas être identique à l'e-mail");
  const u = (await qa('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0]; // propre compte (id issu de la session)
  if (!(await bcrypt.compare(ancien || '', u.password_hash))) throw new HttpError(400, 'Ancien mot de passe incorrect');
  await qa('UPDATE users SET password_hash=$1, mot_de_passe_defini=TRUE, must_change_password=FALSE WHERE id=$2', [await bcrypt.hash(nouveau, 12), req.user.id]);
  await audit(null, req.user, 'password_change', 'users', req.user.id, null, null);
  res.json({ ok: true });
}));

// --- Notifications ---
priv.get('/notifications', ah(async (req, res) => {
  const { rows } = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json(rows);
}));
priv.get('/notifications/count', ah(async (req, res) => {
  const { rows } = await q('SELECT COUNT(*)::int n FROM notifications WHERE user_id=$1 AND NOT lu', [req.user.id]);
  res.json({ non_lues: rows[0].n });
}));
priv.post('/notifications/lu-tout', ah(async (req, res) => { await q('UPDATE notifications SET lu=TRUE WHERE user_id=$1', [req.user.id]); res.json({ ok: true }); }));
priv.post('/notifications/:id(\\d+)/lu', ah(async (req, res) => { await q('UPDATE notifications SET lu=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); }));

priv.post('/push/subscribe', ah(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || endpoint.length < 8 || endpoint.length > 1000 || /[\u0000-\u001F\u007F]/.test(endpoint) || !keys || typeof keys !== 'object' || Array.isArray(keys) || JSON.stringify(keys).length > 1000)
    throw new HttpError(400, 'Abonnement invalide');
  // Application mobile : « fcm:<jeton> » ; navigateur : adresse https du service de notification
  if (!endpoint.startsWith('fcm:') && !/^https:\/\/[^\s]+$/.test(endpoint)) throw new HttpError(400, 'Abonnement invalide');
  if (!req.user.school_id) throw new HttpError(400, 'Notifications push indisponibles pour ce compte');
  await q('INSERT INTO push_subscriptions(user_id,endpoint,keys) VALUES ($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, keys=$3', [req.user.id, endpoint, JSON.stringify(keys)]);
  // Un appareil = un seul abonnement : si l'application renvoie un nouveau jeton (réinstallation, rotation FCM), l'ancien est supprimé
  // pour que le téléphone ne reçoive pas chaque notification deux fois (et qu'un ancien titulaire du téléphone n'en reçoive plus).
  if (typeof keys.device === 'string' && /^[\w-]{8,100}$/.test(keys.device))
    await q("DELETE FROM push_subscriptions WHERE keys->>'device'=$1 AND endpoint<>$2", [keys.device, endpoint]);
  res.json({ ok: true });
}));

// Déconnexion d'un appareil mobile : on retire son jeton pour qu'il ne reçoive plus les notifications de ce compte
priv.post('/push/unsubscribe', ah(async (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1000 || /[\u0000-\u001F\u007F]/.test(endpoint)) throw new HttpError(400, 'Abonnement invalide');
  await q('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, req.user.id]);
  res.json({ ok: true });
}));

// --- Fichiers (accès authentifié) ---
// Les fichiers sont rangés par école (uploads/<school_id>/…) : on ne sert que le dossier de l'école de l'utilisateur
priv.get('/files/:name', (req, res) => {
  // Le super-administrateur n'a pas d'école : ses fichiers (photo de profil) sont dans uploads/platform/
  const dossier = req.user.school_id ? String(req.user.school_id) : req.user.role === 'superadmin' ? 'platform' : null;
  if (!dossier) return res.status(404).json({ error: 'Fichier introuvable' });
  const nom = path.basename(req.params.name);
  // Types affichables sans risque ; tout autre fichier (ancien « .html » par exemple) est servi comme simple téléchargement, jamais comme page web
  if (!['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'].includes(path.extname(nom).toLowerCase())) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
  }
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.sendFile(path.join(config.uploadDir, dossier, nom), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable' }); });
});

// --- Journaux (admin) ---
priv.get('/audit', allow('admin'), ah(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.entite) { params.push(req.query.entite); where.push(`a.entite=$${params.length}`); }
  if (req.query.entite_id) { params.push(req.query.entite_id); where.push(`a.entite_id=$${params.length}`); }
  const { rows } = await q(
    `SELECT a.*, u.nom||' '||u.prenom AS utilisateur FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 300`, params);
  res.json(rows);
}));
priv.get('/journaux/notifications', allow('admin'), ah(async (_req, res) => {
  res.json((await q('SELECT l.*, u.nom||\' \'||u.prenom AS destinataire FROM notification_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 300')).rows);
}));
priv.get('/journaux/acces', allow('admin'), ah(async (_req, res) => {
  res.json((await q('SELECT l.*, u.nom||\' \'||u.prenom AS utilisateur FROM access_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 300')).rows);
}));

// --- RGPD : portabilité & effacement ---
priv.get('/rgpd/export/:id(\\d+)', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== id) throw new HttpError(403, 'Accès refusé');
  const user = (await q('SELECT id,email,role,nom,prenom,telephone,specialite,consentement_rgpd_at,created_at FROM users WHERE id=$1', [id])).rows[0];
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');
  const enfants = (await q('SELECT e.* FROM eleves e JOIN eleve_parents ep ON ep.eleve_id=e.id WHERE ep.parent_id=$1', [id])).rows;
  const messages = (await q('SELECT m.id,m.objet,m.corps,m.sent_at FROM messages m LEFT JOIN message_recipients r ON r.message_id=m.id WHERE m.statut=\'envoye\' AND (m.sender_id=$1 OR r.user_id=$1)', [id])).rows;
  const paiements = (await q('SELECT p.* FROM paiements p JOIN eleve_parents ep ON ep.eleve_id=p.eleve_id WHERE ep.parent_id=$1 AND p.deleted_at IS NULL', [id])).rows;
  res.setHeader('Content-Disposition', `attachment; filename="donnees-utilisateur-${id}.json"`);
  res.json({ exporte_le: new Date().toISOString(), user, enfants, messages, paiements });
}));
priv.post('/rgpd/effacement/:id(\\d+)', allow('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas effacer votre propre compte');
  await tx(async (cl) => {
    await cl.query(
      `UPDATE users SET nom='Anonyme', prenom='Utilisateur', email=$2, telephone=NULL, specialite=NULL, actif=FALSE, deleted_at=now(), password_hash='x' WHERE id=$1`,
      [id, `effacé-${id}@invalid.local`]);
    await cl.query('DELETE FROM push_subscriptions WHERE user_id=$1', [id]);
    await audit(cl, req.user, 'rgpd_effacement', 'users', id, null, null);
  });
  res.json({ ok: true });
}));

module.exports = { pub, priv, reponseConnexion };

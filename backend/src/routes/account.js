// Authentification, compte, notifications, push, RGPD, configuration, fichiers
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const { q, tx, qa, runWith } = require('../db');
const { sign, auth, allow, abonnementBloque } = require('../auth');
const { audit } = require('../audit');
const { ah, HttpError } = require('../util');
const config = require('../config');
const V = require('../services/validate');

const pub = express.Router(); // routes publiques
const priv = express.Router(); // routes authentifiées

// Configuration publique : le nom affiché est celui de l'école demandée (?ecole=slug), sinon le nom de la plateforme
pub.get('/config', ah(async (req, res) => {
  let nom = config.plateformeNom;
  if (req.query.ecole) {
    const s = (await qa('SELECT nom FROM schools WHERE slug=$1', [String(req.query.ecole).slice(0, 60)])).rows[0];
    if (s) nom = s.nom;
  }
  res.json({ anneeCourante: config.anneeCourante, ecoleNom: nom, vapidPublicKey: config.vapid?.pub || null });
}));

pub.post('/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'E-mail et mot de passe requis');
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 120 || password.length > 128) throw new HttpError(400, 'E-mail ou mot de passe invalide');
  // La connexion n'a pas encore d'école : on retrouve le compte par son e-mail (unique dans toute la base)
  const { rows } = await qa(
    `SELECT u.*, s.nom AS school_nom, s.slug AS school_slug, s.status AS school_status, s.subscription_end
     FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.email=$1 AND u.deleted_at IS NULL`, [String(email).toLowerCase().trim()]);
  const u = rows[0];
  const ok = u && u.actif && (await bcrypt.compare(password, u.password_hash));
  if (!ok) throw new HttpError(401, 'Identifiants incorrects');
  if (u.role !== 'superadmin') {
    const refus = abonnementBloque({ status: u.school_status, subscription_end: u.subscription_end });
    if (refus) throw new HttpError(403, refus);
    await runWith({ schoolId: u.school_id, schoolNom: u.school_nom }, () => audit(null, u, 'login', 'users', u.id, null, null));
  }
  res.json({ token: sign(u), user: { id: u.id, email: u.email, role: u.role, nom: u.nom, prenom: u.prenom, school: u.school_id ? { id: u.school_id, nom: u.school_nom, slug: u.school_slug } : null } });
}));

priv.get('/auth/me', (req, res) => res.json({ ...req.user, school: req.school }));

priv.post('/auth/change-password', ah(async (req, res) => {
  const { ancien, nouveau } = req.body || {};
  if (typeof ancien !== 'string' || ancien.length > 128) throw new HttpError(400, 'Ancien mot de passe invalide');
  V.motDePasse(nouveau, 'Le nouveau mot de passe');
  if (nouveau === ancien) throw new HttpError(400, "Le nouveau mot de passe doit être différent de l'ancien");
  const u = (await qa('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0]; // propre compte (id issu de la session)
  if (!(await bcrypt.compare(ancien || '', u.password_hash))) throw new HttpError(400, 'Ancien mot de passe incorrect');
  await qa('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(nouveau, 12), req.user.id]);
  await audit(null, req.user, 'password_change', 'users', req.user.id, null, null);
  res.json({ ok: true });
}));

// --- Notifications ---
priv.get('/notifications', ah(async (req, res) => {
  const { rows } = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json(rows);
}));
priv.get('/notifications/count', ah(async (req, res) => {
  const { rows } = await q('SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND NOT lu', [req.user.id]);
  res.json({ non_lues: rows[0].n });
}));
priv.post('/notifications/lu-tout', ah(async (req, res) => { await q('UPDATE notifications SET lu=TRUE WHERE user_id=$1', [req.user.id]); res.json({ ok: true }); }));
priv.post('/notifications/:id(\\d+)/lu', ah(async (req, res) => { await q('UPDATE notifications SET lu=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); }));

priv.post('/push/subscribe', ah(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys) throw new HttpError(400, 'Abonnement invalide');
  if (!req.user.school_id) throw new HttpError(400, 'Notifications push indisponibles pour ce compte');
  await q('INSERT INTO push_subscriptions(user_id,endpoint,keys) VALUES ($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, keys=$3', [req.user.id, endpoint, JSON.stringify(keys)]);
  res.json({ ok: true });
}));

// --- Fichiers (accès authentifié) ---
// Les fichiers sont rangés par école (uploads/<school_id>/…) : on ne sert que le dossier de l'école de l'utilisateur
priv.get('/files/:name', (req, res) => {
  if (!req.user.school_id) return res.status(404).json({ error: 'Fichier introuvable' });
  res.sendFile(path.join(config.uploadDir, String(req.user.school_id), path.basename(req.params.name)), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable' }); });
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

module.exports = { pub, priv };

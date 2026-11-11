// Comptes de démonstration de la page de connexion (présentation du projet).
//  - Chaque bouton « École N › Rôle » correspond à une ligne de `demo_accounts` qui pointe vers un VRAI compte de la base
//    (créé par `npm run seed:demo`). Le mot de passe n'est ni stocké dans cette table, ni envoyé au navigateur, ni vérifié :
//    le serveur ouvre simplement la session de ce compte, avec son rôle et ses permissions habituels (RBAC et isolation des écoles inchangés).
//  - Désactivé par défaut en production (DEMO_LOGIN=true pour l'activer le temps d'une présentation). Jamais disponible pour le super-administrateur.
//  - Toute connexion de démonstration est journalisée (audit_log, action « demo_login »).
const express = require('express');
const { qa, runWith } = require('../db');
const { abonnementBloque } = require('../auth');
const { audit } = require('../audit');
const { ah, HttpError } = require('../util');
const config = require('../config');
const { reponseConnexion } = require('./account');

const r = express.Router();
const ROLES = ['admin', 'comptable', 'enseignant', 'eleve', 'parent'];

r.use((_req, res, next) => {
  if (!config.demoLogin) return res.status(404).json({ error: 'Les comptes de démonstration sont désactivés sur ce serveur.', demo: false });
  next();
});

// Boutons à afficher : uniquement les comptes réellement présents et utilisables (école ouverte, compte actif)
r.get('/accounts', ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const { rows } = await qa(
    `SELECT d.groupe, d.role, s.nom AS ecole, s.ville, s.status, s.subscription_end
       FROM demo_accounts d JOIN users u ON u.id=d.user_id AND u.actif AND u.deleted_at IS NULL JOIN schools s ON s.id=u.school_id
      ORDER BY d.groupe`);
  const groupes = new Map();
  for (const x of rows) {
    if (abonnementBloque({ status: x.status, subscription_end: x.subscription_end })) continue;
    if (!groupes.has(x.groupe)) groupes.set(x.groupe, { groupe: x.groupe, ecole: x.ville ? `${x.ecole} (${x.ville})` : x.ecole, roles: [] });
    groupes.get(x.groupe).roles.push(x.role);
  }
  const ordre = (a) => ROLES.indexOf(a);
  res.json({ demo: true, groupes: [...groupes.values()].map((g) => ({ ...g, roles: g.roles.sort((a, b) => ordre(a) - ordre(b)) })) });
}));

r.post('/login', ah(async (req, res) => {
  const groupe = Number(req.body?.groupe); const role = req.body?.role;
  if (!Number.isInteger(groupe) || groupe < 1 || groupe > 3 || !ROLES.includes(role)) throw new HttpError(400, 'Compte de démonstration inconnu');
  const { rows } = await qa(
    `SELECT u.*, s.nom AS school_nom, s.slug AS school_slug, s.ville AS school_ville, s.status AS school_status, s.subscription_end
       FROM demo_accounts d JOIN users u ON u.id=d.user_id LEFT JOIN schools s ON s.id=u.school_id
      WHERE d.groupe=$1 AND d.role=$2 AND u.deleted_at IS NULL`, [groupe, role]);
  const u = rows[0];
  if (!u || !u.actif || u.role === 'superadmin' || u.role !== role) throw new HttpError(404, "Ce compte de démonstration n'est pas disponible (lancer « npm run seed:demo »).");
  const refus = abonnementBloque({ status: u.school_status, subscription_end: u.subscription_end });
  if (refus) throw new HttpError(403, refus);
  await runWith({ schoolId: u.school_id, schoolNom: u.school_nom }, () => audit(null, u, 'demo_login', 'users', u.id, null, { groupe, role }));
  res.json(reponseConnexion(u));
}));

module.exports = r;

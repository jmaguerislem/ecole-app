// Statistiques.
//  - SUPER-ADMINISTRATEUR : statistiques globales de la plateforme (toutes les écoles) – GET /global et GET /ecole/:id.
//    Calculées en base, à chaque appel, avec le pool « propriétaire » (qa). Compteurs uniquement (aucun élève, parent ni montant).
//  - DIRECTEUR : uniquement SA propre école – GET /mon-ecole (détail complet : élèves, enseignants, parents, utilisateurs, classes,
//    absences, présences, paiements…). L'école vient du compte connecté, jamais de l'adresse. Un directeur ne reçoit AUCUNE donnée
//    des autres écoles : /global lui est refusé et /ecole/:id n'accepte que l'identifiant de son école (sinon « introuvable »).
const express = require('express');
const { qa } = require('../db');
const { allow } = require('../auth');
const { ah, HttpError } = require('../util');
const { listerEcoles } = require('../services/ecoles');
const { statsEcole } = require('../services/stats-ecole');

const r = express.Router();
r.use(allow('admin', 'superadmin'));
const n = (v) => Number(v || 0);

async function calculer(user) {
  const ecoles = await listerEcoles({ complet: true }); // même liste (libellés, ordre) que les listes déroulantes
  const [roles, eleves, classes, attente, directeurs, superadmins] = await Promise.all([
    qa("SELECT school_id, role, COUNT(*) n FROM users WHERE deleted_at IS NULL AND school_id IS NOT NULL GROUP BY 1,2"),
    qa("SELECT school_id, statut, COUNT(*) n FROM eleves WHERE deleted_at IS NULL GROUP BY 1,2"),
    qa('SELECT school_id, COUNT(*) n FROM classes WHERE deleted_at IS NULL GROUP BY 1'),
    qa("SELECT school_id, COUNT(*) n FROM preinscriptions WHERE deleted_at IS NULL AND statut='en_attente' GROUP BY 1"),
    user.role === 'superadmin'
      ? qa("SELECT school_id, id, nom, prenom, email, actif FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY nom, prenom")
      : Promise.resolve({ rows: [] }),
    qa("SELECT COUNT(*) n FROM users WHERE role='superadmin' AND deleted_at IS NULL"),
  ]);
  const par = (rows, k = 'school_id') => rows.reduce((m, x) => { (m[x[k]] ||= []).push(x); return m; }, {});
  const R = par(roles.rows); const E = par(eleves.rows); const C = Object.fromEntries(classes.rows.map((x) => [x.school_id, n(x.n)]));
  const P = Object.fromEntries(attente.rows.map((x) => [x.school_id, n(x.n)])); const D = par(directeurs.rows);
  const parRole = (id, role) => n((R[id] || []).find((x) => x.role === role)?.n);

  const lignes = ecoles.map((s) => {
    const o = {
      id: s.id, nom: s.nom, label: s.label, slug: s.slug, ville: s.ville, status: s.status, plan: s.plan, subscription_end: s.subscription_end,
      ouverte: s.ouverte, mon_ecole: user.school_id === s.id,
      directeurs: parRole(s.id, 'admin'), enseignants: parRole(s.id, 'enseignant'), parents: parRole(s.id, 'parent'), comptables: parRole(s.id, 'comptable'),
      comptes_eleves: parRole(s.id, 'eleve'),
      utilisateurs: (R[s.id] || []).reduce((t, x) => t + n(x.n), 0), // tous les comptes de l'école (comme la page Écoles)
      eleves: (E[s.id] || []).reduce((t, x) => t + n(x.n), 0),
      eleves_actifs: n((E[s.id] || []).find((x) => x.statut === 'actif')?.n),
      eleves_par_statut: Object.fromEntries((E[s.id] || []).map((x) => [x.statut, n(x.n)])),
      classes: C[s.id] || 0, preinscriptions_attente: P[s.id] || 0,
    };
    if (user.role === 'superadmin') o.liste_directeurs = (D[s.id] || []).map((d) => ({ id: d.id, nom: `${d.prenom} ${d.nom}`, email: d.email, actif: d.actif }));
    return o;
  });
  const somme = (k) => lignes.reduce((t, x) => t + x[k], 0);
  const statuts = { active: 0, suspended: 0, trial: 0 };
  for (const s of lignes) statuts[s.status] = (statuts[s.status] || 0) + 1;
  return {
    genere_le: new Date().toISOString(), vue: user.role,
    totaux: {
      ecoles: lignes.length, directeurs: somme('directeurs'), superadmins: n(superadmins.rows[0].n),
      utilisateurs: somme('utilisateurs') + n(superadmins.rows[0].n), // tous les comptes, super-administrateur compris
      enseignants: somme('enseignants'), parents: somme('parents'), comptables: somme('comptables'), comptes_eleves: somme('comptes_eleves'),
      eleves: somme('eleves'), eleves_actifs: somme('eleves_actifs'), classes: somme('classes'), preinscriptions_attente: somme('preinscriptions_attente'),
      expirees: lignes.filter((s) => s.status !== 'suspended' && !s.ouverte).length,
    },
    statuts, ecoles: lignes,
  };
}

// Statistiques de l'école du directeur connecté (les seules auxquelles il a droit)
r.get('/mon-ecole', allow('admin'), ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user.school_id) throw new HttpError(403, "Aucune école n'est rattachée à ce compte");
  res.json(await statsEcole(req.user.school_id));
}));
r.get('/global', allow('superadmin'), ah(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await calculer(req.user)); }));
r.get('/ecole/:id(\\d+)', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.user.role === 'admin') { // directeur : seulement son école ; toute autre école est « introuvable » (on ne révèle même pas son existence)
    if (Number(req.params.id) !== Number(req.user.school_id)) throw new HttpError(404, 'École introuvable');
    return res.json({ vue: 'admin', ...(await statsEcole(req.user.school_id)) });
  }
  const g = await calculer(req.user);
  const e = g.ecoles.find((x) => x.id === Number(req.params.id));
  if (!e) throw new HttpError(404, 'École introuvable');
  res.json({ genere_le: g.genere_le, vue: g.vue, ecole: e });
}));
module.exports = r;

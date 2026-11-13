// Aide à la décision (BI) : réservé au DIRECTEUR, sur SA seule école (Row Level Security + école du compte connecté).
// Lecture seule : aucun de ces appels ne modifie la base de données.
// Tout porte sur l'ANNÉE SCOLAIRE EN COURS : l'application ne conserve pas la classe de chaque élève année par année, des tableaux
// « par classe » sur une année passée seraient faux. La comparaison entre années est fournie par le tableau « strategique ».
const express = require('express');
const { allow } = require('../auth');
const { ah, HttpError } = require('../util');
const BI = require('../services/bi');

const r = express.Router();
r.use(allow('admin'));
r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); if (!req.user.school_id) return next(new HttpError(403, "Aucune école n'est rattachée à ce compte")); next(); });

r.get('/simulation', ah(async (req, res) => res.json(await BI.simulation(req.query))));
r.get('/:tableau', ah(async (req, res) => {
  const d = await BI.tableau(req.params.tableau);
  if (!d) throw new HttpError(404, 'Tableau de bord inconnu');
  res.json(d);
}));
module.exports = r;

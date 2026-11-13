// Module « Business Intelligence & Aide à la décision » : 10 tableaux de bord pour le directeur (lecture seule).
const B = require('./base');
const A = require('./tableaux-a');
const T = require('./tableaux-b');

const TABLEAUX = {
  general: A.general, financier: A.financier, pedagogique: A.pedagogique, absences: A.absences, enseignants: A.enseignants,
  inscriptions: T.inscriptions, communication: T.communication, edt: T.edt, risques: T.risques, strategique: T.strategique,
};
async function tableau(nom) {
  const fn = TABLEAUX[nom]; if (!fn) return null;
  const ctx = B.contexte();
  const [data, annees] = await Promise.all([fn(ctx), B.anneesDisponibles(ctx)]);
  return { tableau: nom, annee: ctx.annee, annee_courante: require('../../config').anneeCourante, genere_le: new Date().toISOString(), annees, ...data };
}
async function simulation(params) { return T.simulation(B.contexte(), params); }
module.exports = { tableau, simulation, NOMS: Object.keys(TABLEAUX) };

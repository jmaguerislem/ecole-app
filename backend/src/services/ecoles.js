// Liste des écoles : UNE seule source de vérité, utilisée par tous les écrans qui affichent ou proposent des écoles
// (pré-inscription publique, espace du super-administrateur, en-tête de l'application…).
// Mêmes données (lues en base à chaque appel), même libellé, même ordre → les listes déroulantes sont identiques partout.
const { qa } = require('../db');
const { abonnementBloque } = require('../auth');

const { libelleEcole, norm } = require('../libelle-ecole');

const parLibelle = (a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }) || a.id - b.id;

// complet = true : toutes les écoles avec leurs détails et compteurs (super-administrateur)
// complet = false : version publique, uniquement les écoles ouvertes (ni suspendues ni expirées), sans donnée sensible
async function listerEcoles({ complet = false } = {}) {
  const { rows } = await qa(
    `SELECT s.*,
       (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id AND u.deleted_at IS NULL) AS nb_utilisateurs,
       (SELECT COUNT(*) FROM eleves e WHERE e.school_id=s.id AND e.deleted_at IS NULL) AS nb_eleves
     FROM schools s`);
  const out = rows.map((s) => ({ ...s, label: libelleEcole(s), ouverte: !abonnementBloque(s) })).sort(parLibelle);
  if (complet) return out;
  return out.filter((s) => s.ouverte).map(({ id, nom, slug, ville, label }) => ({ id, nom, slug, ville, label }));
}

module.exports = { libelleEcole, listerEcoles, norm };

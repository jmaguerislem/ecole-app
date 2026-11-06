const { q } = require('../db');
const config = require('../config');
const { assurerTarifsAnnee } = require('./tarifs');

const DUE_SQL = `COALESCE((SELECT SUM(t.montant) FROM tarifs t WHERE t.deleted_at IS NULL AND t.annee_scolaire=$1 AND (t.niveau IS NULL OR t.niveau='' OR t.niveau=c.niveau)),0)`;
const PAID_SQL = `COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.eleve_id=e.id AND p.deleted_at IS NULL AND p.annee_scolaire=$1),0)`;

async function solde(eleveId, annee = config.anneeCourante) {
  await assurerTarifsAnnee(annee);
  const { rows } = await q(
    `SELECT e.id eleve_id, e.nom, e.prenom, e.matricule, ${DUE_SQL} AS total_du, ${PAID_SQL} AS total_paye
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.id=$2`, [annee, eleveId]);
  if (!rows[0]) return null;
  return { ...rows[0], annee_scolaire: annee, solde: Math.round((rows[0].total_du - rows[0].total_paye) * 100) / 100 };
}
async function impayes(annee = config.anneeCourante) {
  await assurerTarifsAnnee(annee);
  const { rows } = await q(
    `SELECT e.id eleve_id, e.nom, e.prenom, c.niveau, ${DUE_SQL} AS total_du, ${PAID_SQL} AS total_paye
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.deleted_at IS NULL AND e.statut='actif' ORDER BY e.nom`, [annee]);
  return rows.map((r) => ({ ...r, solde: Math.round((r.total_du - r.total_paye) * 100) / 100 })).filter((r) => r.solde > 0);
}
module.exports = { solde, impayes };

// Limites par formule. Le propriétaire de la plateforme change la formule d'une école depuis la page « Écoles ».
const { qa } = require('../db');
const { HttpError } = require('../util');

const LIMITES = {
  basic:    { eleves: 50,       utilisateurs: 20 },
  standard: { eleves: 200,      utilisateurs: 80 },
  premium:  { eleves: Infinity, utilisateurs: Infinity },
};

// type : 'eleves' | 'utilisateurs' ; ajout : nombre d'éléments qu'on s'apprête à créer
async function verifierQuota(schoolId, type, ajout = 1) {
  if (!schoolId) return; // le super-administrateur n'appartient à aucune école
  const s = (await qa('SELECT plan FROM schools WHERE id=$1', [schoolId])).rows[0];
  if (!s) return;
  const limite = (LIMITES[s.plan] || LIMITES.basic)[type];
  if (limite === Infinity) return;
  const table = type === 'eleves' ? 'eleves' : 'users';
  const { n } = (await qa(`SELECT COUNT(*) AS n FROM ${table} WHERE school_id=$1 AND deleted_at IS NULL`, [schoolId])).rows[0];
  if (n + ajout > limite)
    throw new HttpError(402, `Limite de votre formule atteinte (${limite} ${type === 'eleves' ? 'élèves' : 'utilisateurs'}). Contactez la plateforme pour passer à la formule supérieure.`);
}
module.exports = { verifierQuota, LIMITES };

// E-mail d'un élève : généré automatiquement (prénom.nom@<domaine de l'école>), unique dans TOUTE la base
// (autres élèves et comptes utilisateurs, toutes écoles confondues : on vérifie donc avec le pool « propriétaire »).
const { qa, currentSchool } = require('../db');

const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function domaine(schoolId) {
  if (process.env.ELEVE_EMAIL_DOMAINE) return process.env.ELEVE_EMAIL_DOMAINE.toLowerCase();
  const s = schoolId ? (await qa('SELECT slug FROM schools WHERE id=$1', [schoolId])).rows[0] : null;
  return `${(s?.slug || 'ecole').slice(0, 40)}.tn`;
}
const pris = async (email, exceptEleveId = 0) =>
  (await qa('SELECT 1 FROM eleves WHERE lower(email)=$1 AND id<>$2 UNION ALL SELECT 1 FROM users WHERE lower(email)=$1 LIMIT 1', [email, exceptEleveId])).rowCount > 0;

// Candidats : prenom.nom, puis prenom.nom.<année de naissance>, puis prenom.nom2, prenom.nom3…
async function genererEmailEleve({ nom, prenom, date_naissance, exceptEleveId = 0, schoolId = currentSchool()?.schoolId }) {
  const p = slug(prenom) || 'eleve'; const n = slug(nom) || 'eleve';
  const local = `${p}.${n}`.replace(/-+/g, '-').slice(0, 60);
  const dom = await domaine(schoolId);
  const an = /^\d{4}/.test(String(date_naissance || '')) ? String(date_naissance).slice(0, 4) : null;
  const candidats = [local, ...(an ? [`${local}.${an}`] : [])];
  for (const c of candidats) if (!(await pris(`${c}@${dom}`, exceptEleveId))) return `${c}@${dom}`;
  for (let i = 2; i < 1000; i++) { const e = `${local}${i}@${dom}`; if (!(await pris(e, exceptEleveId))) return e; }
  throw new Error("Impossible de générer une adresse e-mail unique");
}
module.exports = { genererEmailEleve, slug };

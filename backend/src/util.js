const { q } = require('./db');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pad = (n, l = 6) => String(n).padStart(l, '0');
const anneeDebut = (a) => String(a || '').slice(0, 4);

// Fragments SQL de portée (scope) selon le rôle. `p` ajoute un paramètre et renvoie son $n.
const TEACH_CLASSES = (p, id) =>
  `SELECT classe_id FROM affectations WHERE enseignant_id=${p(id)} AND deleted_at IS NULL UNION SELECT id FROM classes WHERE titulaire_id=${p(id)} AND deleted_at IS NULL`;

function eleveScope(p, u, col) {
  switch (u.role) {
    case 'parent': return `${col} IN (SELECT eleve_id FROM eleve_parents WHERE parent_id=${p(u.id)})`;
    case 'eleve': return `${col} IN (SELECT id FROM eleves WHERE user_id=${p(u.id)} AND deleted_at IS NULL)`;
    case 'enseignant': return `${col} IN (SELECT e.id FROM eleves e WHERE e.classe_id IN (${TEACH_CLASSES(p, u.id)}))`;
    default: return null;
  }
}
const teachSql = (p, u, c, m) =>
  `(${c} IN (SELECT id FROM classes WHERE titulaire_id=${p(u.id)} AND deleted_at IS NULL) OR EXISTS (SELECT 1 FROM affectations a WHERE a.enseignant_id=${p(u.id)} AND a.classe_id=${c} AND a.matiere_id=${m} AND a.deleted_at IS NULL))`;

async function eleveIdsOf(user) {
  if (user.role === 'parent') return (await q('SELECT eleve_id FROM eleve_parents WHERE parent_id=$1', [user.id])).rows.map((r) => r.eleve_id);
  if (user.role === 'eleve') return (await q('SELECT id FROM eleves WHERE user_id=$1 AND deleted_at IS NULL', [user.id])).rows.map((r) => r.id);
  return [];
}
async function canAccessEleve(user, eleveId, { finance = false } = {}) {
  eleveId = Number(eleveId);
  if (user.role === 'admin') return true;
  if (user.role === 'comptable') return finance;
  if (user.role === 'enseignant') {
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };
    const r = await q(`SELECT 1 FROM eleves e WHERE e.id=${p(eleveId)} AND e.classe_id IN (${TEACH_CLASSES(p, user.id)})`, params);
    return r.rowCount > 0;
  }
  return (await eleveIdsOf(user)).includes(eleveId);
}
async function teacherCanTeach(user, classeId, matiereId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'enseignant') return false;
  const params = [];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const r = await q(`SELECT 1 WHERE ${teachSql(p, user, p(classeId) + '::int', p(matiereId) + '::int')}`, params);
  return r.rowCount > 0;
}
// Utilisateurs (élèves + parents) d'une classe : audience des devoirs
async function classAudience(classeId) {
  const { rows } = await q(
    `SELECT e.user_id AS id FROM eleves e WHERE e.classe_id=$1 AND e.deleted_at IS NULL AND e.user_id IS NOT NULL
     UNION SELECT ep.parent_id FROM eleve_parents ep JOIN eleves e ON e.id=ep.eleve_id WHERE e.classe_id=$1 AND e.deleted_at IS NULL`, [classeId]);
  return rows.map((r) => r.id);
}
const parentsOf = async (eleveId) =>
  (await q('SELECT parent_id FROM eleve_parents WHERE eleve_id=$1', [eleveId])).rows.map((r) => r.parent_id);

// ---- Règles de validation partagées ----
const AGE_MIN = 6;
function ageEn(dateStr, ref = new Date()) {
  const str = String(dateStr || '').slice(0, 10);
  const d = new Date(`${str}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(d.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  if (ref.getMonth() < d.getMonth() || (ref.getMonth() === d.getMonth() && ref.getDate() < d.getDate())) age--;
  return age;
}
function checkNaissance(date) {
  const age = ageEn(date);
  if (age === null) throw new HttpError(400, 'Date de naissance invalide');
  if (age < AGE_MIN) throw new HttpError(400, `L'élève doit avoir au moins ${AGE_MIN} ans`);
  if (age > 20) throw new HttpError(400, 'Date de naissance invalide');
}
function checkTelephone(tel) {
  if (tel !== undefined && tel !== null && tel !== '' && !/^\d{8}$/.test(String(tel))) throw new HttpError(400, 'Le numéro de téléphone doit contenir exactement 8 chiffres');
}

module.exports = { TEACH_CLASSES, AGE_MIN, ageEn, checkNaissance, checkTelephone, HttpError, ah, pad, anneeDebut, eleveScope, teachSql, eleveIdsOf, canAccessEleve, teacherCanTeach, classAudience, parentsOf };

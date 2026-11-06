// Règles de saisie partagées : chaque fonction nettoie la valeur (trim) et lève une HttpError 400 explicite si elle est invalide.
const { HttpError } = require('../util');
const { normDate, aujourdhui } = require('./absences');

const bad = (m) => { throw new HttpError(400, m); };
const NIVEAUX = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année'];
const NOM_RE = /^\p{L}[\p{L}\p{M} '’.-]*$/u;
const LIBELLE_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} '’.,&()/+–—-]*$/u;
const vide = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Texte : trim, longueur min/max, format optionnel. `multiligne` conserve les retours à la ligne.
function texte(v, label, { min = 0, max = 255, required = false, re, reMsg, multiligne = false } = {}) {
  if (vide(v)) { if (required) bad(`${label} : champ obligatoire`); return null; }
  const t = multiligne ? String(v).replace(/\r\n/g, '\n').trim() : String(v).trim().replace(/\s+/g, ' ');
  if (t.length < min) bad(`${label} : ${min} caractères minimum`);
  if (t.length > max) bad(`${label} : ${max} caractères maximum`);
  if (re && !re.test(t)) bad(reMsg || `${label} : format invalide`);
  return t;
}
const nomPropre = (v, label) => texte(v, label, { required: true, min: 2, max: 60, re: NOM_RE, reMsg: `${label} : lettres, espaces, apostrophes et tirets uniquement` });
const libelle = (v, label, opts = {}) => texte(v, label, { min: 2, max: 100, re: LIBELLE_RE, reMsg: `${label} : caractères non autorisés`, ...opts });

function nombre(v, label, { min = -Infinity, max = Infinity, entier = false, decimales = 2, required = false } = {}) {
  if (vide(v)) { if (required) bad(`${label} : champ obligatoire`); return null; }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) bad(`${label} : nombre invalide`);
  if (entier && !Number.isInteger(n)) bad(`${label} : nombre entier requis`);
  const f = 10 ** decimales;
  if (!entier && Math.abs(n * f - Math.round(n * f)) > 1e-6) bad(`${label} : ${decimales} décimale(s) maximum`);
  if (n < min) bad(`${label} : minimum ${min}`);
  if (n > max) bad(`${label} : maximum ${max}`);
  return n;
}

function date(v, label, { min, max, required = false } = {}) {
  if (vide(v)) { if (required) bad(`${label} : champ obligatoire`); return null; }
  const iso = normDate(v);
  const d = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) bad(`${label} : date invalide`);
  if (min && iso < min) bad(`${label} : ne peut pas être antérieure au ${min.split('-').reverse().join('/')}`);
  if (max && iso > max) bad(`${label} : ne peut pas être postérieure au ${max.split('-').reverse().join('/')}`);
  return iso;
}
// Bornes d'une année scolaire « 2026-2027 » : 1er septembre → 31 août
function bornesAnnee(annee) {
  const a = Number(String(annee).slice(0, 4));
  return { debut: `${a}-09-01`, fin: `${a + 1}-08-31` };
}
function annee(v, label = "L'année scolaire") {
  if (vide(v)) return null;
  const m = /^(\d{4})-(\d{4})$/.exec(String(v).trim());
  if (!m || Number(m[2]) !== Number(m[1]) + 1 || Number(m[1]) < 2000 || Number(m[1]) > 2100) bad(`${label} : format attendu 2026-2027`);
  return String(v).trim();
}
function choix(v, label, liste, { required = false } = {}) {
  if (vide(v)) { if (required) bad(`${label} : champ obligatoire`); return null; }
  if (!liste.includes(v)) bad(`${label} : valeur invalide`);
  return v;
}
function email(v, label = "L'adresse e-mail") {
  const t = texte(v, label, { required: true, max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) bad(`${label} est invalide`);
  return t;
}
function url(v, label) {
  const t = texte(v, label, { max: 500 });
  if (!t) return null;
  try { if (!['http:', 'https:'].includes(new URL(t).protocol)) throw new Error(); } catch { bad(`${label} : adresse web invalide (http:// ou https://)`); }
  return t;
}
// Photo d'élève : adresse web http(s) ou fichier envoyé sur le serveur (/api/files/<hex>.jpg|png|webp)
function photo(v, label = 'La photo') {
  const t = texte(v, label, { max: 500 });
  if (!t) return null;
  if (/^\/api\/files\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(t)) return t;
  return url(t, label);
}
function heure(v, label) {
  const t = String(v ?? '').slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) bad(`${label} : heure invalide`);
  return t;
}
function motDePasse(v, label = 'Mot de passe') {
  const t = String(v ?? '');
  if (t.length < 8) bad(`${label} : 8 caractères minimum`);
  if (t.length > 72) bad(`${label} : 72 caractères maximum`);
  if (!/\p{L}/u.test(t) || !/\d/.test(t)) bad(`${label} : doit contenir au moins une lettre et un chiffre`);
  return t;
}
const entiersId = (v, label, { max = 50 } = {}) => {
  if (!Array.isArray(v)) bad(`${label} : liste invalide`);
  if (v.length > max) bad(`${label} : ${max} éléments maximum`);
  return [...new Set(v.map((x) => { const n = Number(x); if (!Number.isInteger(n) || n < 1) bad(`${label} : identifiant invalide`); return n; }))];
};

// Pré-inscription (formulaire public et formulaire administrateur) : renvoie les champs nettoyés présents dans `b`.
function preinscription(b, { complet = true } = {}) {
  const o = {}; const has = (k) => complet || b[k] !== undefined;
  if (has('eleve_nom')) o.eleve_nom = nomPropre(b.eleve_nom, "Le nom de l'enfant");
  if (has('eleve_prenom')) o.eleve_prenom = nomPropre(b.eleve_prenom, "Le prénom de l'enfant");
  if (has('parent_nom')) o.parent_nom = nomPropre(b.parent_nom, 'Le nom du parent');
  if (has('parent_prenom')) o.parent_prenom = nomPropre(b.parent_prenom, 'Le prénom du parent');
  if (has('parent_email')) o.parent_email = email(b.parent_email, "L'e-mail du parent");
  if (has('sexe')) o.sexe = choix(b.sexe, 'Le sexe', ['M', 'F']);
  if (has('niveau_souhaite')) o.niveau_souhaite = choix(b.niveau_souhaite, 'Le niveau souhaité', NIVEAUX);
  if (has('adresse')) o.adresse = texte(b.adresse, "L'adresse", { max: 200 });
  if (has('antecedents_medicaux')) o.antecedents_medicaux = texte(b.antecedents_medicaux, 'Les antécédents médicaux', { max: 1000, multiligne: true });
  return o;
}

module.exports = { NIVEAUX, aujourdhui, texte, nomPropre, libelle, nombre, date, bornesAnnee, annee, choix, email, url, photo, heure, motDePasse, entiersId, preinscription };

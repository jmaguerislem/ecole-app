// Règles de validation des absences (partagées par le CRUD « Absences » et la page « Faire l'appel »)
const { q } = require('../db');
const { HttpError } = require('../util');
const config = require('../config');
const { notify } = require('./notify');

const PERIODES = ['matin', 'apres_midi', 'journee'];
const MOTIF_MAX = 200;
const JUSTIF_MAX = 500;
const RETRO_JOURS_ENSEIGNANT = 30; // un enseignant ne peut pas saisir une absence plus ancienne que 30 jours

const pad2 = (n) => String(n).padStart(2, '0');
// Date du jour en Tunisie (YYYY-MM-DD), quel que soit le fuseau du serveur
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
// Accepte une chaîne « YYYY-MM-DD… » ou un objet Date (valeur renvoyée par pg) → « YYYY-MM-DD »
function normDate(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  return String(v || '').slice(0, 10);
}
const addJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Vérifie la date d'absence ; renvoie la date normalisée.
function checkDateAbsence(value, { user, annee = config.anneeCourante } = {}) {
  const iso = normDate(value);
  const d = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso)
    throw new HttpError(400, "Date d'absence invalide");
  const today = aujourdhui();
  if (iso > today) throw new HttpError(400, "La date d'absence ne peut pas être dans le futur");
  if (d.getUTCDay() === 0) throw new HttpError(400, "L'école est fermée le dimanche : aucune absence à saisir");
  const debut = Number(String(annee).slice(0, 4));
  if (debut && (iso < `${debut}-09-01` || iso > `${debut + 1}-08-31`))
    throw new HttpError(400, `La date doit appartenir à l'année scolaire ${annee}`);
  if (user?.role === 'enseignant' && iso < addJours(today, -RETRO_JOURS_ENSEIGNANT))
    throw new HttpError(400, `Un enseignant ne peut pas saisir une absence de plus de ${RETRO_JOURS_ENSEIGNANT} jours (contactez l'administration)`);
  return iso;
}

function checkPeriode(periode) {
  if (!PERIODES.includes(periode)) throw new HttpError(400, 'Période invalide (matin, après-midi ou journée)');
  return periode;
}

// Texte facultatif : nettoyé (trim), null si vide, longueur limitée
function checkTexte(v, max, label) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  if (t.length > max) throw new HttpError(400, `${label} : ${max} caractères maximum`);
  return t || null;
}
const checkMotif = (v) => checkTexte(v, MOTIF_MAX, 'Le motif');
const checkJustification = (v) => checkTexte(v, JUSTIF_MAX, 'La justification');

// L'élève doit exister, être actif et inscrit dans une classe
async function checkEleveActif(client, eleveId) {
  const id = Number(eleveId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Élève invalide');
  const e = (await (client || { query: q }).query(
    'SELECT id, classe_id, statut FROM eleves WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!e) throw new HttpError(400, 'Élève introuvable');
  if (e.statut !== 'actif') throw new HttpError(400, "Cet élève n'est plus actif : impossible de saisir une absence");
  if (!e.classe_id) throw new HttpError(400, "Cet élève n'est affecté à aucune classe");
  return e;
}

// Une seule absence par élève et par jour
async function checkDoublon(client, eleveId, date, excludeId = null) {
  const r = await (client || { query: q }).query(
    'SELECT id FROM absences WHERE eleve_id=$1 AND date_absence=$2 AND deleted_at IS NULL AND ($3::int IS NULL OR id<>$3) LIMIT 1',
    [eleveId, date, excludeId]);
  if (r.rowCount) throw new HttpError(409, 'Une absence est déjà enregistrée pour cet élève à cette date (modifiez-la au lieu d\'en créer une autre)');
}

// Notifie les parents (+ e-mail si SMTP configuré) et l'élève s'il a un compte, quand une absence est enregistrée
const QUAND = { matin: 'matin', apres_midi: 'après-midi', journee: 'toute la journée' };
async function notifierAbsence(a) {
  const e = (await q('SELECT nom, prenom, user_id FROM eleves WHERE id=$1', [a.eleve_id])).rows[0];
  if (!e) return;
  const parents = (await q('SELECT parent_id FROM eleve_parents WHERE eleve_id=$1', [a.eleve_id])).rows.map((r) => r.parent_id);
  const jour = new Date(`${normDate(a.date_absence)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const quand = `le ${jour} (${QUAND[a.periode] || a.periode})`;
  const motif = a.motif ? ` Motif indiqué : ${a.motif}.` : '';
  await notify(parents, {
    type: 'absence', titre: `Absence de ${e.prenom} ${e.nom}`,
    corps: `${e.prenom} a été noté(e) absent(e) ${quand}.${motif} Vous pouvez justifier cette absence depuis la page Absences.`, lien: '/absences',
  }, { email: true });
  if (e.user_id) await notify([e.user_id], { type: 'absence', titre: 'Absence enregistrée', corps: `Tu as été noté(e) absent(e) ${quand}.${motif}`, lien: '/absences' });
}

module.exports = { notifierAbsence, PERIODES, MOTIF_MAX, JUSTIF_MAX, aujourdhui, normDate, checkDateAbsence, checkPeriode, checkMotif, checkJustification, checkEleveActif, checkDoublon };

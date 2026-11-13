// Suivi de la vie scolaire : retards d'arrivée des élèves, absences / remplacements des enseignants, réclamations des parents.
// Règles de validation et notifications, partagées par les routes et par l'appel.
const { q } = require('../db');
const V = require('./validate');
const A = require('./absences');
const { notify } = require('./notify');
const { HttpError } = require('../util');

const MINUTES_MAX = 240;
const CATEGORIES = { pedagogique: 'Pédagogie', vie_scolaire: 'Vie scolaire', financier: 'Finances', administratif: 'Administratif', autre: 'Autre' };
const STATUTS = { ouverte: 'Ouverte', en_cours: 'En cours', resolue: 'Résolue', rejetee: 'Rejetée' };
const OBJET_MAX = 150; const DESC_MIN = 10; const DESC_MAX = 2000; const REPONSE_MAX = 2000;

// ----- Retards d'arrivée -----
function checkMinutes(v) {
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > MINUTES_MAX) throw new HttpError(400, `La durée du retard doit être un nombre entier de minutes entre 1 et ${MINUTES_MAX}`);
  return m;
}
// Mêmes règles de date que les absences (pas de futur, pas de dimanche, dans l'année scolaire), avec des messages adaptés
function checkDateRetard(value, opts) {
  try { return A.checkDateAbsence(value, opts); } catch (e) {
    if (e instanceof HttpError) throw new HttpError(e.status, e.message.replace(/d'absence/g, 'de retard').replace(/une absence/g, 'un retard').replace(/aucune absence/g, 'aucun retard').replace(/absence/g, 'retard'));
    throw e;
  }
}
// Un seul retard par élève et par jour ; un élève absent toute la journée ne peut pas être en retard
async function checkDoublonRetard(client, eleveId, date, excludeId = null) {
  const c = client || { query: q };
  if ((await c.query('SELECT id FROM retards WHERE eleve_id=$1 AND date_retard=$2 AND deleted_at IS NULL AND ($3::int IS NULL OR id<>$3) LIMIT 1', [eleveId, date, excludeId])).rowCount)
    throw new HttpError(409, 'Un retard est déjà enregistré pour cet élève à cette date (modifiez-le au lieu d\'en créer un autre)');
  if ((await c.query("SELECT id FROM absences WHERE eleve_id=$1 AND date_absence=$2 AND periode='journee' AND deleted_at IS NULL LIMIT 1", [eleveId, date])).rowCount)
    throw new HttpError(409, 'Cet élève est déjà noté absent toute la journée à cette date : il ne peut pas être en retard');
}
async function notifierRetard(r) {
  const e = (await q('SELECT nom, prenom, user_id FROM eleves WHERE id=$1', [r.eleve_id])).rows[0]; if (!e) return;
  const parents = (await q('SELECT parent_id FROM eleve_parents WHERE eleve_id=$1', [r.eleve_id])).rows.map((x) => x.parent_id);
  const jour = new Date(`${A.normDate(r.date_retard)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const motif = r.motif ? ` Motif indiqué : ${r.motif}.` : '';
  await notify(parents, { type: 'retard', titre: `Retard de ${e.prenom} ${e.nom}`, corps: `${e.prenom} est arrivé(e) en retard (${r.minutes} min) le ${jour}.${motif}`, lien: '/retards' }, { email: true });
  if (e.user_id) await notify([e.user_id], { type: 'retard', titre: 'Retard enregistré', corps: `Tu es arrivé(e) en retard (${r.minutes} min) le ${jour}.${motif}`, lien: '/retards' });
}

// ----- Absences et remplacements des enseignants -----
// L'absence d'un enseignant peut être saisie à l'avance (congé prévu) : pas plus de 60 jours dans le futur, jamais un dimanche.
const FUTUR_MAX_JOURS = 60;
function checkDateAbsenceEnseignant(value, annee) {
  const iso = A.normDate(value); const d = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new HttpError(400, "Date d'absence invalide");
  if (d.getUTCDay() === 0) throw new HttpError(400, "L'école est fermée le dimanche");
  const limite = new Date(`${A.aujourdhui()}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() + FUTUR_MAX_JOURS);
  if (iso > limite.toISOString().slice(0, 10)) throw new HttpError(400, `La date ne peut pas dépasser ${FUTUR_MAX_JOURS} jours dans le futur`);
  const b = V.bornesAnnee(annee); if (iso < b.debut || iso > b.fin) throw new HttpError(400, `La date doit appartenir à l'année scolaire ${annee}`);
  return iso;
}
async function checkEnseignant(client, id, label) {
  const u = (await client.query('SELECT role, actif FROM users WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!u || u.role !== 'enseignant') throw new HttpError(400, `${label} : choisissez un enseignant de l'école`);
  if (!u.actif) throw new HttpError(400, `${label} : ce compte est désactivé`);
}
async function notifierRemplacement(a) {
  if (!a.remplacant_id) return;
  const e = (await q("SELECT prenom||' '||nom n FROM users WHERE id=$1", [a.enseignant_id])).rows[0];
  const jour = new Date(`${A.normDate(a.date_absence)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const quand = { matin: 'le matin', apres_midi: "l'après-midi", journee: 'toute la journée' }[a.periode] || '';
  await notify([a.remplacant_id], { type: 'remplacement', titre: 'Remplacement', corps: `Vous remplacez ${e?.n || 'un collègue'} le ${jour} (${quand}). Consultez l'emploi du temps pour ses classes.`, lien: '/emploi-du-temps' });
}

// ----- Réclamations -----
const texte = (v, label, { min = 0, max }) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < min) throw new HttpError(400, `${label} : ${min} caractères minimum`);
  if (t.length > max) throw new HttpError(400, `${label} : ${max} caractères maximum`);
  return t;
};
async function notifierReclamation(r, { creation, statutChange }) {
  const admins = (await q("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL AND actif")).rows.map((x) => x.id);
  if (creation) {
    const p = (await q("SELECT prenom||' '||nom n FROM users WHERE id=$1", [r.parent_id])).rows[0];
    await notify(admins, { type: 'reclamation', titre: 'Nouvelle réclamation', corps: `${p?.n || 'Un parent'} : ${r.objet}`, lien: '/reclamations' });
  } else if (statutChange) {
    await notify([r.parent_id], { type: 'reclamation', titre: `Réclamation ${STATUTS[r.statut].toLowerCase()}`, corps: `Votre réclamation « ${r.objet} » est maintenant : ${STATUTS[r.statut].toLowerCase()}.${r.reponse ? ` Réponse : ${r.reponse}` : ''}`.slice(0, 600), lien: '/reclamations' }, { email: true });
  }
}

module.exports = { MINUTES_MAX, CATEGORIES, STATUTS, OBJET_MAX, DESC_MIN, DESC_MAX, REPONSE_MAX, checkMinutes, checkDateRetard, checkDoublonRetard, notifierRetard,
  checkDateAbsenceEnseignant, checkEnseignant, notifierRemplacement, texte, notifierReclamation };

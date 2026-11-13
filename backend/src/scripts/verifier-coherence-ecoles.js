// Audit des relations entre tables et école (`school_id`) : aucune ligne ne doit référencer une ligne d'une AUTRE école,
// et aucune ligne d'école ne doit être sans `school_id`. C'est la condition pour que les statistiques par école soient exactes.
// Usage : npm run ecoles:verifier      (code de sortie 1 s'il y a une incohérence ; lecture seule)
const { qa, end } = require('../db');

// [table enfant, colonne de liaison, table référencée]
const RELATIONS = [
  ['classes', 'titulaire_id', 'users'], ['affectations', 'enseignant_id', 'users'], ['affectations', 'matiere_id', 'matieres'], ['affectations', 'classe_id', 'classes'],
  ['eleves', 'classe_id', 'classes'], ['eleves', 'user_id', 'users'], ['eleve_parents', 'eleve_id', 'eleves'], ['eleve_parents', 'parent_id', 'users'],
  ['preinscriptions', 'eleve_id', 'eleves'], ['preinscriptions', 'traitee_par', 'users'],
  ['creneaux', 'classe_id', 'classes'], ['creneaux', 'matiere_id', 'matieres'], ['creneaux', 'enseignant_id', 'users'], ['creneaux', 'salle_id', 'salles'],
  ['evaluations', 'classe_id', 'classes'], ['evaluations', 'matiere_id', 'matieres'], ['evaluations', 'created_by', 'users'],
  ['notes', 'evaluation_id', 'evaluations'], ['notes', 'eleve_id', 'eleves'],
  ['absences', 'eleve_id', 'eleves'], ['paiements', 'eleve_id', 'eleves'], ['paiements', 'tarif_id', 'tarifs'], ['paiements', 'created_by', 'users'],
  ['messages', 'sender_id', 'users'], ['messages', 'eleve_id', 'eleves'], ['message_recipients', 'message_id', 'messages'], ['message_recipients', 'user_id', 'users'],
  ['annonces', 'auteur_id', 'users'], ['devoirs', 'matiere_id', 'matieres'], ['devoirs', 'classe_id', 'classes'], ['devoirs', 'enseignant_id', 'users'],
  ['depots', 'devoir_id', 'devoirs'], ['depots', 'eleve_id', 'eleves'], ['devoir_vus', 'devoir_id', 'devoirs'], ['devoir_vus', 'eleve_id', 'eleves'], ['devoir_vus', 'parent_id', 'users'],
  ['notifications', 'user_id', 'users'],
  ['retards', 'eleve_id', 'eleves'], ['absences_enseignants', 'enseignant_id', 'users'], ['absences_enseignants', 'remplacant_id', 'users'],
  ['reclamations', 'parent_id', 'users'], ['reclamations', 'eleve_id', 'eleves'], ['reclamations', 'traite_par', 'users'],
];
const SANS_ECOLE_INTERDIT = ['classes', 'matieres', 'affectations', 'salles', 'eleves', 'eleve_parents', 'preinscriptions', 'creneaux', 'evaluations', 'notes', 'absences', 'tarifs', 'paiements',
  'messages', 'message_recipients', 'annonces', 'devoirs', 'depots', 'devoir_vus', 'notifications', 'tarifs_historique', 'retards', 'absences_enseignants', 'reclamations'];

async function verifier() {
  const problemes = [];
  for (const [enfant, col, parent] of RELATIONS) {
    const { rows } = await qa(`SELECT COUNT(*)::int n FROM ${enfant} c JOIN ${parent} p ON p.id = c.${col} WHERE c.school_id IS DISTINCT FROM p.school_id`);
    if (rows[0].n) problemes.push({ type: 'relation entre écoles', detail: `${enfant}.${col} → ${parent}`, lignes: rows[0].n });
  }
  for (const t of SANS_ECOLE_INTERDIT) {
    const { rows } = await qa(`SELECT COUNT(*)::int n FROM ${t} WHERE school_id IS NULL`);
    if (rows[0].n) problemes.push({ type: 'school_id manquant', detail: t, lignes: rows[0].n });
  }
  const u = await qa("SELECT COUNT(*)::int n FROM users WHERE school_id IS NULL AND role <> 'superadmin'");
  if (u.rows[0].n) problemes.push({ type: 'school_id manquant', detail: 'users (hors super-administrateur)', lignes: u.rows[0].n });
  return problemes;
}

module.exports = { verifier, RELATIONS };

if (require.main === module) {
  verifier().then((p) => {
    if (!p.length) console.log(`✔ Cohérent : ${RELATIONS.length} relations vérifiées, aucune donnée ne référence une autre école.`);
    else { console.log('✘ Incohérences :'); console.table(p); process.exitCode = 1; }
  }).catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => end());
}

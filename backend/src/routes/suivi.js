// Suivi de la vie scolaire (fabrique CRUD) : retards d'arrivée, absences / remplacements des enseignants, réclamations des parents.
const { q } = require('../db');
const crud = require('../crud');
const { HttpError, eleveScope, canAccessEleve } = require('../util');
const config = require('../config');
const A = require('../services/absences');
const S = require('../services/suivi');

// ---------- Retards d'arrivée des élèves ----------
// Saisis par l'enseignant (à l'appel ou ici) ou la direction ; visibles par les parents et l'élève concernés.
const retards = crud({
  table: 'retards', fields: ['eleve_id', 'date_retard', 'minutes', 'motif', 'justifie'], required: ['eleve_id', 'date_retard', 'minutes'], annee: true,
  read: ['admin', 'enseignant', 'parent', 'eleve'], write: ['admin', 'enseignant'], filters: ['eleve_id', 'justifie'],
  from: 'retards t JOIN eleves e ON e.id=t.eleve_id', columns: `t.*, e.nom||' '||e.prenom AS eleve_nom`, order: 't.date_retard DESC, t.id DESC',
  scope: (u, p) => eleveScope(p, u, 't.eleve_id'),
  async beforeSave({ data, merged, old, isNew, user, client }) {
    if (!(await canAccessEleve(user, merged.eleve_id))) throw new HttpError(403, "Cet élève n'est pas dans vos classes");
    if (isNew || data.eleve_id !== undefined) await A.checkEleveActif(client, merged.eleve_id);
    if (old?.justifie && user.role !== 'admin') throw new HttpError(403, "Retard déjà justifié : seul l'administrateur peut le modifier");
    const dateIso = A.normDate(merged.date_retard);
    if (isNew || data.date_retard !== undefined) data.date_retard = S.checkDateRetard(merged.date_retard, { user, annee: merged.annee_scolaire || config.anneeCourante });
    if (isNew || data.minutes !== undefined) data.minutes = S.checkMinutes(merged.minutes);
    if (data.motif !== undefined) data.motif = A.checkMotif(data.motif);
    if (user.role !== 'admin' && data.justifie !== undefined && !!data.justifie !== !!old?.justifie) throw new HttpError(403, "Seul l'administrateur peut justifier un retard");
    await S.checkDoublonRetard(client, merged.eleve_id, dateIso, old?.id);
  },
  async afterCommit({ row, isNew }) { if (isNew && !row.justifie) await S.notifierRetard(row); },
  async beforeDelete({ user, old }) { if (old.justifie && user.role !== 'admin') throw new HttpError(403, "Retard déjà justifié : seul l'administrateur peut le supprimer"); },
});

// ---------- Absences et remplacements des enseignants (direction) ----------
const absencesEnseignants = crud({
  table: 'absences_enseignants', fields: ['enseignant_id', 'date_absence', 'periode', 'motif', 'justifiee', 'remplacant_id'], required: ['enseignant_id', 'date_absence'], annee: true,
  read: ['admin', 'enseignant'], write: ['admin'], filters: ['enseignant_id', 'remplacant_id', 'justifiee'],
  from: 'absences_enseignants t JOIN users u ON u.id=t.enseignant_id LEFT JOIN users r ON r.id=t.remplacant_id',
  columns: `t.*, u.prenom||' '||u.nom AS enseignant_nom, r.prenom||' '||r.nom AS remplacant_nom`, order: 't.date_absence DESC, t.id DESC',
  // un enseignant ne voit que ses propres absences et les remplacements qu'on lui confie
  scope: (u, p) => (u.role === 'enseignant' ? `(t.enseignant_id=${p(u.id)} OR t.remplacant_id=${p(u.id)})` : null),
  async beforeSave({ data, merged, old, isNew, client }) {
    if (isNew || data.enseignant_id !== undefined) await S.checkEnseignant(client, merged.enseignant_id, "L'enseignant absent");
    if (merged.remplacant_id) {
      if (Number(merged.remplacant_id) === Number(merged.enseignant_id)) throw new HttpError(400, 'Un enseignant ne peut pas se remplacer lui-même');
      if (isNew || data.remplacant_id !== undefined) await S.checkEnseignant(client, merged.remplacant_id, 'Le remplaçant');
    }
    if (isNew || data.date_absence !== undefined) data.date_absence = S.checkDateAbsenceEnseignant(merged.date_absence, merged.annee_scolaire || config.anneeCourante);
    const date = A.normDate(merged.date_absence);
    if (isNew || data.periode !== undefined) data.periode = A.checkPeriode(merged.periode || 'journee');
    if (data.motif !== undefined) data.motif = A.checkMotif(data.motif);
    if ((await client.query('SELECT id FROM absences_enseignants WHERE enseignant_id=$1 AND date_absence=$2 AND deleted_at IS NULL AND ($3::int IS NULL OR id<>$3) LIMIT 1', [merged.enseignant_id, date, old?.id])).rowCount)
      throw new HttpError(409, 'Une absence est déjà enregistrée pour cet enseignant à cette date (modifiez-la au lieu d\'en créer une autre)');
    // Le remplaçant ne peut pas être lui-même absent à cette date
    if (merged.remplacant_id && (await client.query('SELECT id FROM absences_enseignants WHERE enseignant_id=$1 AND date_absence=$2 AND deleted_at IS NULL LIMIT 1', [merged.remplacant_id, date])).rowCount)
      throw new HttpError(409, 'Le remplaçant choisi est lui-même absent à cette date');
  },
  async afterCommit({ row, old }) { if (row.remplacant_id && row.remplacant_id !== old?.remplacant_id) await S.notifierRemplacement(row); },
});

// ---------- Réclamations des parents ----------
// Le parent dépose une réclamation (sur son enfant ou en général) et suit son traitement ; la direction répond et change le statut.
// Une fois déposée, le parent ne peut plus la modifier ni la supprimer (elle fait foi). Seule la direction traite.
const CHAMPS_PARENT = ['parent_id', 'eleve_id', 'categorie', 'objet', 'description'];
const reclamations = crud({
  table: 'reclamations', fields: ['parent_id', 'eleve_id', 'categorie', 'objet', 'description', 'statut', 'reponse'], required: ['objet', 'description'], annee: true,
  read: ['admin', 'parent'], write: ['admin', 'parent'], filters: ['statut', 'categorie', 'eleve_id', 'parent_id'],
  from: `reclamations t JOIN users p ON p.id=t.parent_id LEFT JOIN eleves e ON e.id=t.eleve_id LEFT JOIN users tr ON tr.id=t.traite_par`,
  columns: `t.*, p.prenom||' '||p.nom AS parent_nom, e.prenom||' '||e.nom AS eleve_nom, tr.prenom||' '||tr.nom AS traite_par_nom`, order: 't.created_at DESC, t.id DESC',
  scope: (u, p) => (u.role === 'parent' ? `t.parent_id=${p(u.id)}` : null),
  async beforeSave({ data, merged, old, isNew, user, client }) {
    if (user.role === 'parent') {
      if (!isNew) throw new HttpError(403, 'Une réclamation envoyée ne peut plus être modifiée : la direction la traite');
      data.parent_id = user.id; delete data.statut; delete data.reponse; // le parent ne choisit ni le statut ni la réponse
      merged.parent_id = user.id;
    } else if (!isNew) {
      for (const k of CHAMPS_PARENT) delete data[k]; // la direction ne réécrit pas la réclamation du parent : elle la traite
    } else if (!merged.parent_id) throw new HttpError(400, 'Indiquez le parent concerné');
    if (isNew || data.parent_id !== undefined) {
      const p = (await client.query("SELECT 1 FROM users WHERE id=$1 AND role='parent' AND deleted_at IS NULL", [merged.parent_id])).rowCount;
      if (!p) throw new HttpError(400, 'Parent introuvable');
    }
    if (merged.eleve_id && (isNew || data.eleve_id !== undefined)) {
      const ok = (await client.query('SELECT 1 FROM eleve_parents WHERE eleve_id=$1 AND parent_id=$2', [merged.eleve_id, merged.parent_id])).rowCount;
      if (!ok) throw new HttpError(403, user.role === 'parent' ? "Cet élève n'est pas votre enfant" : "Cet élève n'est pas un enfant de ce parent");
    }
    if (isNew) {
      data.objet = S.texte(merged.objet, "L'objet", { min: 3, max: S.OBJET_MAX });
      data.description = S.texte(merged.description, 'La description', { min: S.DESC_MIN, max: S.DESC_MAX });
      data.categorie = merged.categorie || 'autre';
      if (!S.CATEGORIES[data.categorie]) throw new HttpError(400, 'Catégorie invalide');
    }
    if (user.role === 'admin' && !isNew) {
      if (data.statut !== undefined && !S.STATUTS[data.statut]) throw new HttpError(400, 'Statut invalide');
      if (data.reponse !== undefined) data.reponse = data.reponse === null ? null : S.texte(data.reponse, 'La réponse', { max: S.REPONSE_MAX }) || null;
      const statut = data.statut ?? old.statut; const reponse = data.reponse !== undefined ? data.reponse : old.reponse;
      if (['resolue', 'rejetee'].includes(statut) && !reponse) throw new HttpError(400, 'Une réponse est obligatoire pour résoudre ou rejeter une réclamation');
      data.traite_par = user.id; data.updated_at = new Date().toISOString();
      data.resolved_at = ['resolue', 'rejetee'].includes(statut) ? (old.resolved_at && ['resolue', 'rejetee'].includes(old.statut) ? old.resolved_at : new Date().toISOString()) : null;
    }
  },
  async afterCommit({ row, old, isNew }) { await S.notifierReclamation(row, { creation: isNew, statutChange: !isNew && (row.statut !== old.statut || (row.reponse || '') !== (old.reponse || '')) }); },
  async beforeDelete({ user }) { if (user.role !== 'admin') throw new HttpError(403, 'Une réclamation envoyée ne peut pas être supprimée'); },
});

module.exports = { retards, absencesEnseignants, reclamations };

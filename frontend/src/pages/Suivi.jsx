import { useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import { Alert, Modal, Pill } from '../components/ui.jsx';
import { opt } from './Entities.jsx';

// Suivi de la vie scolaire : retards d'arrivée des élèves, absences / remplacements des enseignants, réclamations des parents.
// Le serveur applique les droits et les validations ; ces pages ne font que les rendre simples à utiliser.
const iso = (d) => d.toISOString().slice(0, 10);
const PERIODES = [{ value: 'journee', label: 'Journée' }, { value: 'matin', label: 'Matin' }, { value: 'apres_midi', label: 'Après-midi' }];
const PERIODE_LABEL = Object.fromEntries(PERIODES.map((p) => [p.value, p.label]));
const CATEGORIES = [{ value: 'pedagogique', label: 'Pédagogie' }, { value: 'vie_scolaire', label: 'Vie scolaire' }, { value: 'financier', label: 'Finances' }, { value: 'administratif', label: 'Administratif' }, { value: 'autre', label: 'Autre' }];
const CATEGORIE_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const STATUTS = { ouverte: ['Ouverte', 'warn'], en_cours: ['En cours', ''], resolue: ['Résolue', 'ok'], rejetee: ['Rejetée', 'bad'] };

// ---------- Retards d'arrivée ----------
export function Retards() {
  const { user } = useAuth();
  const write = ['admin', 'enseignant'].includes(user.role);
  return (
    <CrudPage title="Retards d'arrivée" endpoint="/retards" annee canWrite={write}
      hint={write ? "Les retards se saisissent aussi directement dans « Faire l'appel ». Les parents sont prévenus à chaque retard." : "Retards d'arrivée en classe enregistrés par l'école."}
      columns={[{ key: 'eleve_nom', label: 'Élève' }, { label: 'Date', render: (r) => fmtDate(r.date_retard) }, { label: 'Retard', render: (r) => `${r.minutes} min` }, { key: 'motif', label: 'Motif' },
        { label: 'Justifié', render: (r) => <Pill kind={r.justifie ? 'ok' : 'warn'}>{r.justifie ? 'Oui' : 'Non'}</Pill> }]}
      fields={[{ name: 'eleve_id', label: 'Élève', type: 'select', optionsFrom: opt.eleve, required: true },
        { name: 'date_retard', label: 'Date', type: 'date', required: true, min: user.role === 'admin' ? undefined : iso(new Date(Date.now() - 30 * 864e5)), max: iso(new Date()), help: 'Pas de date future, pas de dimanche.' },
        { name: 'minutes', label: 'Durée du retard (minutes)', type: 'number', min: 1, max: 240, step: 1, required: true },
        { name: 'motif', label: 'Motif', maxLength: 200 },
        ...(user.role === 'admin' ? [{ name: 'justifie', label: 'Retard justifié', type: 'checkbox' }] : [])]}
      defaults={{ minutes: 10 }} />
  );
}

// ---------- Absences et remplacements des enseignants ----------
export function AbsencesEnseignants() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  return (
    <CrudPage title="Absences des enseignants" endpoint="/absences-enseignants" annee canWrite={admin}
      hint={admin ? 'Déclarez l’absence d’un enseignant et désignez son remplaçant : celui-ci est prévenu. Les indicateurs alimentent « Aide à la décision ».' : 'Vos absences et les remplacements qui vous sont confiés.'}
      columns={[{ key: 'enseignant_nom', label: 'Enseignant' }, { label: 'Date', render: (r) => fmtDate(r.date_absence) }, { label: 'Période', render: (r) => PERIODE_LABEL[r.periode] || r.periode }, { key: 'motif', label: 'Motif' },
        { label: 'Justifiée', render: (r) => <Pill kind={r.justifiee ? 'ok' : 'warn'}>{r.justifiee ? 'Oui' : 'Non'}</Pill> },
        { label: 'Remplaçant', render: (r) => (r.remplacant_nom ? r.remplacant_nom : <Pill kind="bad">Non remplacé</Pill>) }]}
      fields={[{ name: 'enseignant_id', label: 'Enseignant absent', type: 'select', optionsFrom: opt.prof, required: true },
        { name: 'date_absence', label: 'Date', type: 'date', required: true, help: 'Une absence prévue (congé) peut être saisie jusqu’à 60 jours à l’avance. Pas de dimanche.' },
        { name: 'periode', label: 'Période', type: 'select', required: true, options: PERIODES },
        { name: 'motif', label: 'Motif', maxLength: 200 },
        { name: 'justifiee', label: 'Absence justifiée', type: 'checkbox' },
        { name: 'remplacant_id', label: 'Remplaçant (facultatif)', type: 'select', optionsFrom: opt.prof, help: 'Un autre enseignant de l’école, lui-même présent ce jour-là.' }]}
      defaults={{ periode: 'journee' }} />
  );
}

// ---------- Réclamations des parents ----------
function Traiter({ r, reload }) {
  const [open, setOpen] = useState(false); const [statut, setStatut] = useState(r.statut === 'ouverte' ? 'en_cours' : r.statut); const [reponse, setReponse] = useState(r.reponse || '');
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);
  const clore = statut === 'resolue' || statut === 'rejetee';
  const save = async () => {
    setErr(''); setSaving(true);
    try { await api(`/reclamations/${r.id}`, { method: 'PUT', body: { statut, reponse: reponse.trim() || null } }); setOpen(false); reload(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>Traiter</button>
      {open && (
        <Modal title="Traiter la réclamation" onClose={() => setOpen(false)} wide>
          <p><b>{r.objet}</b><br /><span className="muted small">{r.parent_nom}{r.eleve_nom ? ` · à propos de ${r.eleve_nom}` : ''} · {CATEGORIE_LABEL[r.categorie]} · déposée le {fmtDate(r.created_at)}</span></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
          <Alert>{err}</Alert>
          <div><label htmlFor="rec-statut">Statut</label>
            <select id="rec-statut" value={statut} onChange={(e) => setStatut(e.target.value)}>{Object.entries(STATUTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div style={{ marginTop: '.75rem' }}><label htmlFor="rec-reponse">Réponse au parent{clore ? ' (obligatoire pour résoudre ou rejeter)' : ' (facultative)'}</label>
            <textarea id="rec-reponse" rows={5} maxLength={2000} value={reponse} onChange={(e) => setReponse(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn sec" onClick={() => setOpen(false)}>Annuler</button>
            <button type="button" className="btn" onClick={save} disabled={saving || (clore && !reponse.trim())}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Reclamations() {
  const { user } = useAuth();
  const admin = user.role === 'admin'; const [statut, setStatut] = useState('');
  const colonnes = [{ label: 'Date', render: (r) => fmtDate(r.created_at) }, ...(admin ? [{ key: 'parent_nom', label: 'Parent' }] : []), { key: 'eleve_nom', label: 'Élève' },
    { label: 'Catégorie', render: (r) => CATEGORIE_LABEL[r.categorie] || r.categorie }, { key: 'objet', label: 'Objet' },
    { label: 'Statut', render: (r) => <Pill kind={STATUTS[r.statut][1]}>{STATUTS[r.statut][0]}</Pill> },
    { label: 'Réponse', render: (r) => (r.reponse ? (r.reponse.length > 80 ? `${r.reponse.slice(0, 80)}…` : r.reponse) : '—') }];
  return (
    <CrudPage title="Réclamations" endpoint="/reclamations" annee canWrite={!admin} query={statut ? { statut } : {}}
      canEditRow={() => false} canDeleteRow={() => false}
      hint={admin ? 'Réclamations déposées par les parents. Répondez et changez le statut : le parent est prévenu.' : 'Déposez une réclamation : la direction vous répond ici. Une fois envoyée, elle ne peut plus être modifiée.'}
      toolbar={admin && <select aria-label="Filtrer par statut" value={statut} onChange={(e) => setStatut(e.target.value)} style={{ maxWidth: 190 }}><option value="">Tous les statuts</option>{Object.entries(STATUTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>}
      columns={colonnes}
      fields={[{ name: 'eleve_id', label: 'Concernant (facultatif)', type: 'select', optionsFrom: opt.eleve, help: 'Choisissez votre enfant si la réclamation le concerne.' },
        { name: 'categorie', label: 'Catégorie', type: 'select', required: true, options: CATEGORIES },
        { name: 'objet', label: 'Objet', required: true, minLength: 3, maxLength: 150 },
        { name: 'description', label: 'Description', type: 'textarea', full: true, required: true, minLength: 10, maxLength: 2000, help: 'Expliquez précisément la situation (10 caractères minimum).' }]}
      defaults={{ categorie: 'autre' }}
      rowActions={(r, reload) => admin && <Traiter r={r} reload={reload} />} />
  );
}

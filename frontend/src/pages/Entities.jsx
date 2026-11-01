import { useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { api, download, fmtDate, money } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import { Alert, Modal, Pill } from '../components/ui.jsx';

// Règles de saisie partagées : âge minimum 6 ans, téléphone tunisien à 8 chiffres
const AGE_MIN = 6;
const _p = (n) => String(n).padStart(2, '0');
const _iso = (d) => `${d.getFullYear()}-${_p(d.getMonth() + 1)}-${_p(d.getDate())}`;
const _t = new Date();
const NAISSANCE = {
  min: `${_t.getFullYear() - 20}-01-01`,
  max: _iso(new Date(_t.getFullYear() - AGE_MIN, _t.getMonth(), _t.getDate())),
  help: `L'élève doit avoir au moins ${AGE_MIN} ans.`,
};
import MesAbsences from './MesAbsences.jsx';
import { NOM, LIBELLE, ANNEE, EMAIL, MOT_DE_PASSE } from '../rules.js';
const TEL = { type: 'tel', inputMode: 'numeric', maxLength: 8, pattern: '[0-9]{8}', placeholder: '8 chiffres', title: 'Numéro tunisien : 8 chiffres' };

const opt = {
  classe: { url: '/classes', label: (r) => `${r.nom} (${r.annee_scolaire})` },
  matiere: { url: '/matieres', label: (r) => r.nom },
  prof: { url: '/users?role=enseignant', label: (r) => r.nom_complet },
  parent: { url: '/users?role=parent', label: (r) => r.nom_complet },
  eleveUser: { url: '/users?role=eleve', label: (r) => r.nom_complet },
  eleve: { url: '/eleves', label: (r) => `${r.nom} ${r.prenom}` },
  salle: { url: '/salles', label: (r) => r.nom },
  tarif: { url: '/tarifs', label: (r) => `${r.libelle} (${money(r.montant)})` },
};
export const NIVEAUX = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année'].map((v) => ({ value: v, label: v }));
const isAdmin = (u) => u.role === 'admin';

export function Classes() {
  const { user } = useAuth();
  return <CrudPage title="Classes" endpoint="/classes" annee canWrite={isAdmin(user)}
    columns={[{ key: 'nom', label: 'Classe' }, { key: 'capacite', label: 'Capacité' }, { key: 'effectif', label: 'Effectif' }, { key: 'titulaire_nom', label: 'Titulaire' }, { key: 'annee_scolaire', label: 'Année' }]}
    fields={[{ name: 'niveau', label: 'Niveau', type: 'select', options: NIVEAUX, required: true }, { name: 'section', label: 'Section (A, B…)', maxLength: 3, pattern: '[A-Za-z0-9]{1,3}', title: '1 à 3 lettres ou chiffres' }, { name: 'capacite', label: 'Capacité maximale', type: 'number', min: 1, max: 50, step: 1, required: true },
      { name: 'titulaire_id', label: 'Enseignant titulaire', type: 'select', optionsFrom: opt.prof }, { name: 'annee_scolaire', label: 'Année scolaire', help: 'Ex. 2026-2027', ...ANNEE }]}
    defaults={{ capacite: 25 }} />;
}
export function Matieres() {
  const { user } = useAuth();
  return <CrudPage title="Matières" endpoint="/matieres" canWrite={isAdmin(user)}
    columns={[{ key: 'nom', label: 'Matière' }, { key: 'coefficient', label: 'Coefficient' }, { key: 'niveau', label: 'Niveau' }]}
    fields={[{ name: 'nom', label: 'Nom', required: true, ...LIBELLE(60) }, { name: 'coefficient', label: 'Coefficient', type: 'number', step: '0.5', min: 0.5, max: 10, required: true }, { name: 'niveau', label: 'Niveau concerné (vide = tous)', type: 'select', options: NIVEAUX }]}
    defaults={{ coefficient: 1 }} />;
}
export const Salles = () => <CrudPage title="Salles" endpoint="/salles"
  columns={[{ key: 'nom', label: 'Salle' }, { key: 'capacite', label: 'Capacité' }, { key: 'disponible', label: 'Disponible' }]}
  fields={[{ name: 'nom', label: 'Nom', required: true, ...LIBELLE(50), minLength: 1 }, { name: 'capacite', label: 'Capacité', type: 'number', min: 1, max: 200, step: 1 }, { name: 'disponible', label: 'Salle disponible', type: 'checkbox', default: true }]} />;
export const Affectations = () => <CrudPage title="Affectations enseignant ↔ matière ↔ classe" endpoint="/affectations" annee
  columns={[{ key: 'enseignant_nom', label: 'Enseignant' }, { key: 'matiere_nom', label: 'Matière' }, { key: 'classe_nom', label: 'Classe' }, { key: 'annee_scolaire', label: 'Année' }]}
  fields={[{ name: 'enseignant_id', label: 'Enseignant', type: 'select', optionsFrom: opt.prof, required: true }, { name: 'matiere_id', label: 'Matière', type: 'select', optionsFrom: opt.matiere, required: true }, { name: 'classe_id', label: 'Classe', type: 'select', optionsFrom: opt.classe, required: true }]} />;

const userFields = (extra = []) => [
  { name: 'nom', label: 'Nom', required: true, ...NOM }, { name: 'prenom', label: 'Prénom', required: true, ...NOM }, { name: 'email', label: 'E-mail (identifiant)', type: 'email', required: true, ...EMAIL },
  { name: 'telephone', label: 'Téléphone', ...TEL }, ...extra,
  { name: 'password', label: 'Mot de passe', type: 'password', help: 'Laisser vide pour ne pas changer. 8 caractères minimum, avec une lettre et un chiffre.', ...MOT_DE_PASSE },
  { name: 'actif', label: 'Compte actif', type: 'checkbox', default: true },
];
const userCols = [{ key: 'nom_complet', label: 'Nom' }, { key: 'email', label: 'E-mail' }, { key: 'telephone', label: 'Téléphone' }, { key: 'actif', label: 'Actif' }];
export function Enseignants() {
  return <CrudPage title="Enseignants" endpoint="/users" query={{ role: 'enseignant' }} columns={[...userCols, { key: 'specialite', label: 'Spécialité' }]} fields={userFields([{ name: 'specialite', label: 'Spécialité', maxLength: 80 }])} transformBody={(b) => ({ ...b, role: 'enseignant' })} />;
}
export function Parents() {
  const { user } = useAuth();
  return <CrudPage title="Parents" endpoint="/users" query={{ role: 'parent' }} canWrite={isAdmin(user)} columns={userCols} fields={userFields()} transformBody={(b) => ({ ...b, role: 'parent' })} />;
}
export const Comptes = () => <CrudPage title="Tous les comptes" endpoint="/users" columns={[...userCols, { key: 'role', label: 'Rôle' }]}
  fields={userFields([{ name: 'role', label: 'Rôle', type: 'select', required: true, options: [['admin', 'Administrateur'], ['enseignant', 'Enseignant'], ['parent', 'Parent'], ['eleve', 'Élève'], ['comptable', 'Comptable / Secrétariat']].map(([value, label]) => ({ value, label })) }])} />;

export function Eleves() {
  const { user } = useAuth();
  const nav = useNavigate();
  const file = useRef();
  const [msg, setMsg] = useState(null);
  const write = ['admin', 'comptable'].includes(user.role);
  const importCsv = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const form = new FormData(); form.append('file', f);
    try { const r = await api('/eleves/import', { method: 'POST', form }); setMsg({ kind: r.erreurs.length ? 'info' : 'ok', t: `${r.importes} élève(s) importé(s).${r.erreurs.length ? ' Erreurs : ' + r.erreurs.map((x) => `ligne ${x.ligne} (${x.message})`).join(' ; ') : ''}` }); }
    catch (x) { setMsg({ kind: 'err', t: x.message }); }
    e.target.value = '';
  };
  return (
    <div>
      {msg && <Alert kind={msg.kind}>{msg.t}</Alert>}
      <CrudPage title="Élèves" endpoint="/eleves" canWrite={write}
        hint={write ? "Colonnes d'import CSV : nom, prenom, date_naissance, sexe, adresse, annee_entree, classe (ex. « 1ère année A »), matricule." : null}
        toolbar={write && <><button className="btn sec" onClick={() => download('/eleves/export', 'eleves.csv')}>Exporter CSV</button><button className="btn sec" onClick={() => file.current.click()}>Importer CSV</button><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={importCsv} /></>}
        columns={[{ key: 'matricule', label: 'Matricule' }, { label: 'Élève', render: (r) => `${r.nom} ${r.prenom}` }, { key: 'classe_nom', label: 'Classe' }, { label: 'Naissance', render: (r) => fmtDate(r.date_naissance) }, { label: 'Statut', render: (r) => <Pill kind={r.statut === 'actif' ? 'ok' : ''}>{r.statut}</Pill> }]}
        fields={[{ name: 'nom', label: 'Nom', required: true, ...NOM }, { name: 'prenom', label: 'Prénom', required: true, ...NOM }, { name: 'date_naissance', label: 'Date de naissance', type: 'date', ...NAISSANCE },
          { name: 'sexe', label: 'Sexe', type: 'select', options: [{ value: 'M', label: 'Garçon' }, { value: 'F', label: 'Fille' }] }, { name: 'matricule', label: 'Matricule', help: 'Généré automatiquement si vide', maxLength: 20, pattern: '[A-Za-z0-9\\-]+', title: 'Lettres, chiffres et tirets' },
          { name: 'classe_id', label: 'Classe', type: 'select', optionsFrom: opt.classe }, { name: 'annee_entree', label: "Année d'entrée", ...ANNEE },
          { name: 'statut', label: 'Statut', type: 'select', options: ['actif', 'inactif', 'diplome'].map((v) => ({ value: v, label: v })), required: true },
          { name: 'parent_ids', label: 'Parents / tuteurs (Ctrl+clic pour plusieurs)', type: 'multiselect', optionsFrom: opt.parent, full: true },
          { name: 'user_id', label: "Compte de connexion de l'élève", type: 'select', optionsFrom: opt.eleveUser },
          { name: 'photo', label: 'Photo (URL)', type: 'url', maxLength: 500, placeholder: 'https://…' }, { name: 'adresse', label: 'Adresse', full: true, maxLength: 200 }, { name: 'antecedents_medicaux', label: 'Antécédents médicaux', type: 'textarea', full: true, maxLength: 1000 }]}
        defaults={{ statut: 'actif' }}
        rowActions={(r, reload, { setInfo, setError }) => <>
          <button className="btn sec sm" onClick={() => nav(`/bulletins?eleve=${r.id}`)}>Bulletin</button>
          {write && !r.classe_id && <button className="btn sec sm" onClick={async () => { try { const x = await api(`/eleves/${r.id}/auto-affectation`, { method: 'POST' }); setInfo(`Affecté automatiquement en ${x.niveau}.`); reload(); } catch (e) { setError(e.message); } }}>Affecter</button>}
        </>} />
    </div>
  );
}

function ValidateButton({ row, reload, setInfo, setError }) {
  const [open, setOpen] = useState(false); const [classe, setClasse] = useState(''); const [classes, setClasses] = useState([]);
  const show = async () => { setClasses(await api('/classes')); setOpen(true); };
  const valider = async () => {
    try { const r = await api(`/preinscriptions/${row.id}/valider`, { method: 'POST', body: { classe_id: classe || undefined } });
      setInfo(`Inscription validée. ${r.mot_de_passe_temporaire ? `Compte parent ${r.parent_email} créé – mot de passe temporaire : ${r.mot_de_passe_temporaire} (à transmettre au parent).` : 'Parent existant rattaché.'}`);
      setOpen(false); reload(); } catch (e) { setError(e.message); setOpen(false); }
  };
  const refuser = async () => { const motif = window.prompt('Motif du refus (optionnel) :'); if (motif === null) return; try { await api(`/preinscriptions/${row.id}/refuser`, { method: 'POST', body: { motif } }); reload(); } catch (e) { setError(e.message); } };
  if (row.statut !== 'en_attente') return null;
  return <>
    <button className="btn sm" onClick={show}>Valider</button><button className="btn danger sm" onClick={refuser}>Refuser</button>
    {open && <Modal title="Valider la pré-inscription" onClose={() => setOpen(false)}>
      <p>Un dossier élève et un compte parent seront créés.</p>
      <label htmlFor="cl">Affecter à une classe (optionnel)</label>
      <select id="cl" value={classe} onChange={(e) => setClasse(e.target.value)}><option value="">— Plus tard —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.effectif}/{c.capacite})</option>)}</select>
      <div className="row" style={{ marginTop: '1rem' }}><button className="btn" onClick={valider}>Valider</button><button className="btn sec" onClick={() => setOpen(false)}>Annuler</button></div></Modal>}
  </>;
}
export const Preinscriptions = () => <CrudPage title="Pré-inscriptions" endpoint="/preinscriptions" annee
  hint="Lien public du formulaire à communiquer aux familles : /preinscription"
  columns={[{ label: 'Enfant', render: (r) => `${r.eleve_nom} ${r.eleve_prenom}` }, { label: 'Naissance', render: (r) => fmtDate(r.date_naissance) }, { key: 'niveau_souhaite', label: 'Niveau' }, { label: 'Parent', render: (r) => `${r.parent_nom} ${r.parent_prenom} – ${r.parent_email}` },
    { label: 'Statut', render: (r) => <Pill kind={r.statut === 'validee' ? 'ok' : r.statut === 'refusee' ? 'bad' : 'warn'}>{r.statut.replace('_', ' ')}</Pill> }]}
  fields={[{ name: 'eleve_nom', label: "Nom de l'enfant", required: true, ...NOM }, { name: 'eleve_prenom', label: "Prénom de l'enfant", required: true, ...NOM }, { name: 'date_naissance', label: 'Naissance', type: 'date', required: true, ...NAISSANCE },
    { name: 'niveau_souhaite', label: 'Niveau', type: 'select', options: NIVEAUX }, { name: 'parent_nom', label: 'Nom du parent', required: true, ...NOM }, { name: 'parent_prenom', label: 'Prénom du parent', required: true, ...NOM },
    { name: 'parent_email', label: 'E-mail du parent', type: 'email', required: true, ...EMAIL }, { name: 'parent_telephone', label: 'Téléphone', ...TEL }]}
  rowActions={(r, reload, h) => <ValidateButton row={r} reload={reload} {...h} />} canEditRow={(r) => r.statut === 'en_attente'} />;

export const Tarifs = () => <CrudPage title="Grille tarifaire" endpoint="/tarifs" annee
  columns={[{ key: 'libelle', label: 'Libellé' }, { key: 'type', label: 'Type' }, { key: 'niveau', label: 'Niveau' }, { label: 'Montant', render: (r) => money(r.montant) }, { label: 'Échéance', render: (r) => fmtDate(r.echeance) }]}
  fields={[{ name: 'libelle', label: 'Libellé', required: true, ...LIBELLE(100) }, { name: 'type', label: 'Type', type: 'select', required: true, options: ['inscription', 'scolarite', 'tranche', 'autre'].map((v) => ({ value: v, label: v })) },
    { name: 'niveau', label: 'Niveau (vide = tous)', type: 'select', options: NIVEAUX }, { name: 'montant', label: 'Montant (TND)', type: 'number', step: '0.01', min: 0.01, max: 100000, required: true }, { name: 'echeance', label: 'Échéance', type: 'date', help: "Doit être dans l'année scolaire (1er sept. → 31 août)." }, { name: 'annee_scolaire', label: 'Année scolaire', ...ANNEE }]}
  defaults={{ type: 'scolarite' }} />;

export function Evaluations() {
  const nav = useNavigate();
  return <CrudPage title="Évaluations" endpoint="/evaluations" annee
    columns={[{ key: 'titre', label: 'Titre' }, { key: 'classe_nom', label: 'Classe' }, { key: 'matiere_nom', label: 'Matière' }, { label: 'Type', render: (r) => (r.type === 'examen_trimestriel' ? 'Examen' : 'Contrôle continu') }, { key: 'trimestre', label: 'Trim.' }, { label: 'Date', render: (r) => fmtDate(r.date_eval) }, { key: 'bareme', label: 'Barème' }, { key: 'nb_notes', label: 'Notes saisies' }]}
    fields={[{ name: 'titre', label: 'Titre', required: true, ...LIBELLE(100) }, { name: 'classe_id', label: 'Classe', type: 'select', optionsFrom: opt.classe, required: true }, { name: 'matiere_id', label: 'Matière', type: 'select', optionsFrom: opt.matiere, required: true },
      { name: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'controle_continu', label: 'Contrôle continu' }, { value: 'examen_trimestriel', label: 'Examen trimestriel' }] },
      { name: 'trimestre', label: 'Trimestre', type: 'select', required: true, options: [1, 2, 3].map((v) => ({ value: v, label: `Trimestre ${v}` })) }, { name: 'date_eval', label: 'Date', type: 'date' }, { name: 'bareme', label: 'Barème (sur)', type: 'number', step: '0.5', min: 1, max: 100, required: true }]}
    defaults={{ type: 'controle_continu', trimestre: 1, bareme: 20 }}
    rowActions={(r) => <button className="btn sm" onClick={() => nav(`/notes/${r.id}`)}>Saisir les notes</button>} />;
}

export function Absences() {
  const { user } = useAuth();
  if (user.role === 'eleve') return <MesAbsences />;
  const write = ['admin', 'enseignant'].includes(user.role);
  return <CrudPage title="Absences" endpoint="/absences" annee canWrite={write}
    columns={[{ key: 'eleve_nom', label: 'Élève' }, { label: 'Date', render: (r) => fmtDate(r.date_absence) }, { key: 'periode', label: 'Période' }, { key: 'motif', label: 'Motif' },
      { label: 'Justifiée', render: (r) => <Pill kind={r.justifiee ? 'ok' : 'warn'}>{r.justifiee ? 'Oui' : 'Non'}</Pill> }, { key: 'justification', label: 'Justification' }]}
    fields={[{ name: 'eleve_id', label: 'Élève', type: 'select', optionsFrom: opt.eleve, required: true },
      { name: 'date_absence', label: 'Date', type: 'date', required: true, min: user.role === 'admin' ? undefined : _iso(new Date(Date.now() - 30 * 864e5)), max: _iso(new Date()), help: "Pas de date future, pas de dimanche." + (user.role === 'admin' ? '' : ' 30 jours maximum en arrière.') },
      { name: 'periode', label: 'Période', type: 'select', required: true, options: [{ value: 'journee', label: 'Journée' }, { value: 'matin', label: 'Matin' }, { value: 'apres_midi', label: 'Après-midi' }] },
      { name: 'motif', label: 'Motif', maxLength: 200 },
      // La justification est réservée à l'administrateur (et au parent via le bouton « Justifier »)
      ...(user.role === 'admin' ? [{ name: 'justifiee', label: 'Justifiée', type: 'checkbox' }, { name: 'justification', label: 'Justification (obligatoire si justifiée)', type: 'textarea', full: true, maxLength: 500 }] : [])]}
    defaults={{ periode: 'journee' }}
    rowActions={(r, reload, { setError, setInfo }) => user.role === 'parent' && !r.justifiee && <button className="btn sm" onClick={async () => {
      const j = (window.prompt("Motif de justification de l'absence (5 caractères minimum, 500 maximum) :") || '').trim(); if (!j) return;
      if (j.length < 5 || j.length > 500) { setError('La justification doit contenir entre 5 et 500 caractères.'); return; }
      try { await api(`/absences/${r.id}/justifier`, { method: 'PUT', body: { justification: j } }); setInfo('Absence justifiée.'); reload(); } catch (e) { setError(e.message); } }}>Justifier</button>} />;
}
export { opt };

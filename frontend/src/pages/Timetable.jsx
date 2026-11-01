import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import { opt } from './Entities.jsx';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const hm = (t) => String(t).slice(0, 5);

export default function Timetable() {
  const { user } = useAuth();
  const canWrite = ['admin', 'enseignant'].includes(user.role);
  const [tab, setTab] = useState('semaine');
  const [rows, setRows] = useState(null); const [classe, setClasse] = useState(''); const [classes, setClasses] = useState([]);
  const [jour, setJour] = useState(0); // vue jour (mobile) : 0 = semaine
  useEffect(() => { api('/classes').then(setClasses).catch(() => {}); }, []);
  useEffect(() => { api(`/creneaux${classe ? `?classe_id=${classe}` : ''}`).then(setRows).catch(() => setRows([])); }, [classe, tab]);
  const days = jour ? [jour] : [1, 2, 3, 4, 5, 6];
  return (
    <div>
      <h1>Emploi du temps</h1>
      {canWrite && <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'semaine'} onClick={() => setTab('semaine')}>Vue calendrier</button>
        <button role="tab" aria-selected={tab === 'gerer'} onClick={() => setTab('gerer')}>Gérer les créneaux</button></div>}
      {tab === 'semaine' && <>
        <div className="row" style={{ marginBottom: '1rem' }}>
          {classes.length > 1 && <div><label htmlFor="c">Classe</label><select id="c" value={classe} onChange={(e) => setClasse(e.target.value)}><option value="">Toutes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>}
          <div><label htmlFor="j">Affichage</label><select id="j" value={jour} onChange={(e) => setJour(Number(e.target.value))}><option value={0}>Semaine</option>{JOURS.map((j, i) => <option key={j} value={i + 1}>{j}</option>)}</select></div>
        </div>
        {rows === null ? <p>Chargement…</p> : <div className="week" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(150px,1fr))` }}>
          {days.map((d) => (
            <div key={d} className="day"><h3>{JOURS[d - 1]}</h3>
              {rows.filter((r) => r.jour === d).map((r) => (
                <div key={r.id} className="slot"><b>{hm(r.heure_debut)}–{hm(r.heure_fin)}</b><br />{r.matiere_nom}<br /><span className="muted">{r.classe_nom} · {r.enseignant_nom}{r.salle_nom ? ` · ${r.salle_nom}` : ''}</span></div>))}
              {rows.filter((r) => r.jour === d).length === 0 && <div className="muted small">Aucun cours</div>}
            </div>))}
        </div>}
      </>}
      {tab === 'gerer' && <CrudPage title="Créneaux" endpoint="/creneaux" annee searchable={false}
        hint="Un conflit (enseignant, salle ou classe déjà occupé sur la plage horaire) est détecté et refusé automatiquement."
        columns={[{ label: 'Jour', render: (r) => JOURS[r.jour - 1] }, { label: 'Horaire', render: (r) => `${hm(r.heure_debut)}–${hm(r.heure_fin)}` }, { key: 'classe_nom', label: 'Classe' }, { key: 'matiere_nom', label: 'Matière' }, { key: 'enseignant_nom', label: 'Enseignant' }, { key: 'salle_nom', label: 'Salle' }]}
        fields={[{ name: 'classe_id', label: 'Classe', type: 'select', optionsFrom: opt.classe, required: true }, { name: 'matiere_id', label: 'Matière', type: 'select', optionsFrom: opt.matiere, required: true },
          { name: 'enseignant_id', label: 'Enseignant', type: 'select', required: true, ...(user.role === 'admin' ? { optionsFrom: opt.prof } : { options: [{ value: user.id, label: `${user.prenom} ${user.nom}` }] }) },
          { name: 'salle_id', label: 'Salle', type: 'select', optionsFrom: opt.salle }, { name: 'jour', label: 'Jour', type: 'select', required: true, options: JOURS.map((j, i) => ({ value: i + 1, label: j })) },
          { name: 'heure_debut', label: 'Début', type: 'time', required: true, min: '07:00', max: '19:00', step: 300, help: 'Entre 07:00 et 19:00' }, { name: 'heure_fin', label: 'Fin', type: 'time', required: true, min: '07:00', max: '19:00', step: 300, help: 'Durée : 15 min à 4 h' }]}
        defaults={user.role === 'enseignant' ? { enseignant_id: user.id } : {}} />}
    </div>
  );
}

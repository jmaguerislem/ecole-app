import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Alert, PageHeader } from '../components/ui.jsx';

export default function Bulletins() {
  const [sp] = useSearchParams();
  const [eleves, setEleves] = useState([]); const [eleve, setEleve] = useState(sp.get('eleve') || '');
  const [tri, setTri] = useState(''); const [b, setB] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/eleves').then((l) => { setEleves(l); if (!eleve && l[0]) setEleve(String(l[0].id)); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (!eleve) return; setErr('');
    api(`/eleves/${eleve}/bulletin${tri ? `?trimestre=${tri}` : ''}`).then(setB).catch((e) => { setB(null); setErr(e.message); });
  }, [eleve, tri]);
  return (
    <div>
      <PageHeader title="Bulletins" />
      <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div><label htmlFor="e">Élève</label><select id="e" value={eleve} onChange={(e) => setEleve(e.target.value)}>{eleves.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom} – {e.classe_nom}</option>)}</select></div>
        <div><label htmlFor="t">Période</label><select id="t" value={tri} onChange={(e) => setTri(e.target.value)}><option value="">Année complète</option><option value="1">Trimestre 1</option><option value="2">Trimestre 2</option><option value="3">Trimestre 3</option></select></div>
        {b && <button type="button" className="btn" onClick={() => download(`/eleves/${eleve}/bulletin.pdf${tri ? `?trimestre=${tri}` : ''}`, `bulletin-${b.eleve.nom}.pdf`)}><Icon name="download" size={16} />Télécharger le PDF</button>}
      </div>
      <Alert>{err}</Alert>
      {b && <div className="card">
        <h2>{b.eleve.prenom} {b.eleve.nom} – {b.classe || 'Sans classe'}</h2>
        <p className="muted">Année {b.annee_scolaire} – titulaire : {b.titulaire || '—'}</p>
        <div className="table-wrap"><table><thead><tr><th>Matière</th><th>Coeff.</th><th>Moyenne /20</th><th>Notes</th></tr></thead><tbody>
          {b.matieres.map((m) => <tr key={m.matiere_id}><td>{m.nom}</td><td>{m.coefficient}</td><td><b>{m.moyenne?.toFixed(2)}</b></td><td>{m.nb_notes}</td></tr>)}
          {b.matieres.length === 0 && <tr><td colSpan="4" className="empty">Aucune note pour cette période.</td></tr>}</tbody></table></div>
        <div className="summary">
          <div className="stat"><b>{b.moyenne_generale !== null ? b.moyenne_generale.toFixed(2) : '—'}</b><span>Moyenne générale / 20</span></div>
          {b.rang && <div className="stat"><b>{b.rang}/{b.effectif}</b><span>Rang dans la classe</span></div>}
          {b.rang && <div className="stat"><b>{b.moyenne_classe}</b><span>Moyenne de la classe</span></div>}
          <div className="stat"><b>{b.absences.non_justifiees}</b><span>Absence(s) non justifiée(s) · {b.absences.justifiees} justifiée(s)</span></div>
        </div>
        <p className="appreciation"><b>Appréciation :</b> {b.appreciation || '—'}</p>
      </div>}
    </div>
  );
}

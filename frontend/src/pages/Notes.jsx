import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Alert, PageHeader } from '../components/ui.jsx';

export default function Notes() {
  const { id } = useParams();
  const [data, setData] = useState(null); const [vals, setVals] = useState({}); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const load = () => api(`/evaluations/${id}/notes`).then((d) => { setData(d); setVals(Object.fromEntries(d.eleves.map((e) => [e.eleve_id, { valeur: e.valeur ?? '', commentaire: e.commentaire ?? '' }]))); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  const save = async () => {
    setErr(''); setOk('');
    try { await api(`/evaluations/${id}/notes`, { method: 'PUT', body: { notes: Object.entries(vals).map(([eleve_id, v]) => ({ eleve_id: Number(eleve_id), ...v })) } }); setOk('Notes enregistrées. Laissez une case vide pour supprimer une note.'); load(); }
    catch (e) { setErr(e.message); }
  };
  if (!data) return <Alert>{err}</Alert>;
  const ev = data.evaluation;
  return (
    <div>
      <Link className="back-link" to="/evaluations"><Icon name="arrow-left" size={16} />Évaluations</Link>
      <PageHeader title={ev.titre} subtitle={`${ev.classe_nom} – ${ev.matiere_nom} – Trimestre ${ev.trimestre} – ${fmtDate(ev.date_eval)} – barème /${ev.bareme}`} />
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
      <div className="table-wrap"><table className="notes-grid"><thead><tr><th>Élève</th><th>Note /{ev.bareme}</th><th>Commentaire</th></tr></thead><tbody>
        {data.eleves.map((e) => (
          <tr key={e.eleve_id}><td>{e.nom} {e.prenom}</td>
            <td><input aria-label={`Note de ${e.prenom} ${e.nom}`} type="number" step="0.25" min="0" max={ev.bareme} value={vals[e.eleve_id]?.valeur ?? ''} onChange={(x) => setVals((s) => ({ ...s, [e.eleve_id]: { ...s[e.eleve_id], valeur: x.target.value } }))} /></td>
            <td><input aria-label={`Commentaire pour ${e.prenom} ${e.nom}`} maxLength={300} value={vals[e.eleve_id]?.commentaire ?? ''} onChange={(x) => setVals((s) => ({ ...s, [e.eleve_id]: { ...s[e.eleve_id], commentaire: x.target.value } }))} style={{ maxWidth: 'none' }} /></td></tr>))}
        {data.eleves.length === 0 && <tr><td colSpan="3" className="empty">Aucun élève dans cette classe.</td></tr>}
      </tbody></table></div>
      <div className="modal-actions"><button type="button" className="btn" onClick={save}><Icon name="check" size={16} />Enregistrer les notes</button></div>
    </div>
  );
}

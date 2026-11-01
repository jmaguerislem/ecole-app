import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Pill } from '../components/ui.jsx';

const PERIODES = { matin: 'Matin', apres_midi: 'Après-midi', journee: 'Journée' };

// Page « Absences » de l'élève : lecture seule (aucune saisie, aucune justification)
export default function MesAbsences() {
  const { config } = useAuth();
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/absences').then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, []);
  const stats = useMemo(() => {
    const l = rows || [];
    const jours = (a) => (a.periode === 'journee' ? 1 : 0.5);
    return {
      total: l.length, justifiees: l.filter((a) => a.justifiee).length, non: l.filter((a) => !a.justifiee).length,
      jours: l.reduce((s, a) => s + jours(a), 0),
    };
  }, [rows]);
  return (
    <div>
      <h1>Mes absences</h1>
      <p className="muted">Année scolaire {config.anneeCourante}. Pour justifier une absence, demande à tes parents de le faire depuis leur compte.</p>
      <Alert>{err}</Alert>
      <div className="grid" style={{ marginBottom: '1rem' }}>
        <div className="stat"><b>{stats.total}</b><span>Absence(s)</span></div>
        <div className="stat"><b style={{ color: 'var(--ok)' }}>{stats.justifiees}</b><span>Justifiée(s)</span></div>
        <div className="stat"><b style={{ color: stats.non ? 'var(--bad)' : 'var(--ok)' }}>{stats.non}</b><span>Non justifiée(s)</span></div>
        <div className="stat"><b>{String(stats.jours).replace('.', ',')}</b><span>Jour(s) manqué(s)</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Période</th><th>Motif</th><th>Statut</th><th>Justification</th></tr></thead>
        <tbody>
          {rows === null && <tr><td colSpan="5" className="empty">Chargement…</td></tr>}
          {rows?.length === 0 && <tr><td colSpan="5" className="empty">Aucune absence enregistrée cette année.</td></tr>}
          {rows?.map((a) => (
            <tr key={a.id}><td>{fmtDate(a.date_absence)}</td><td>{PERIODES[a.periode] || a.periode}</td><td>{a.motif || '—'}</td>
              <td><Pill kind={a.justifiee ? 'ok' : 'warn'}>{a.justifiee ? 'Justifiée' : 'Non justifiée'}</Pill></td><td>{a.justification || '—'}</td></tr>))}
        </tbody>
      </table></div>
    </div>
  );
}

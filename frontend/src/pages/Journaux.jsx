import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api.js';

const TABS = {
  audit: { label: 'Modifications', url: '/audit', cols: [['Date', (r) => fmtDateTime(r.created_at)], ['Utilisateur', (r) => r.utilisateur || '—'], ['Action', (r) => r.action], ['Entité', (r) => `${r.entite} #${r.entite_id ?? ''}`], ['Avant → Après', (r) => <details><summary>Détail</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ avant: r.anciennes, apres: r.nouvelles }, null, 1)}</pre></details>]] },
  notifs: { label: 'Envois de notifications', url: '/journaux/notifications', cols: [['Date', (r) => fmtDateTime(r.created_at)], ['Destinataire', (r) => r.destinataire || '—'], ['Canal', (r) => r.canal], ['Sujet', (r) => r.sujet], ['Statut', (r) => r.statut + (r.erreur ? ` (${r.erreur})` : '')]] },
  acces: { label: 'Accès aux conversations', url: '/journaux/acces', cols: [['Date', (r) => fmtDateTime(r.created_at)], ['Utilisateur', (r) => r.utilisateur], ['Ressource', (r) => `${r.ressource} #${r.ressource_id}`]] },
};
export default function Journaux() {
  const [tab, setTab] = useState('audit'); const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api(TABS[tab].url).then(setRows).catch(() => setRows([])); }, [tab]);
  const t = TABS[tab];
  return (
    <div>
      <h1>Journaux d'audit</h1>
      <div className="tabs" role="tablist">{Object.entries(TABS).map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{v.label}</button>)}</div>
      <div className="table-wrap"><table><thead><tr>{t.cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {rows?.map((r) => <tr key={r.id}>{t.cols.map(([h, fn]) => <td key={h}>{fn(r)}</td>)}</tr>)}
        {rows?.length === 0 && <tr><td colSpan={t.cols.length} className="empty">Aucune entrée.</td></tr>}</tbody></table></div>
    </div>
  );
}

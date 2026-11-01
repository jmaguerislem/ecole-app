import { useEffect, useState } from 'react';
import { api, download, fmtDate, money } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import { Alert, Pill } from '../components/ui.jsx';
import { opt } from './Entities.jsx';

const MODES = [{ value: 'especes', label: 'Espèces' }, { value: 'virement', label: 'Virement' }, { value: 'mobile_money', label: 'Mobile money' }];

function Impayes() {
  const [rows, setRows] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api('/paiements/impayes').then(setRows).catch((e) => setErr(e.message)); }, []);
  const relancer = async () => {
    if (!window.confirm(`Envoyer un rappel aux parents des ${rows.length} élèves concernés ?`)) return;
    try { const r = await api('/paiements/relances', { method: 'POST' }); setMsg(`${r.envoyees} relance(s) envoyée(s).`); } catch (e) { setErr(e.message); }
  };
  return (
    <div>
      <div className="row between"><p className="muted">Élèves dont le solde de l'année en cours est positif.</p>{rows?.length > 0 && <button className="btn" onClick={relancer}>Envoyer les relances</button>}</div>
      <Alert>{err}</Alert><Alert kind="ok">{msg}</Alert>
      <div className="table-wrap"><table><thead><tr><th>Élève</th><th>Niveau</th><th>Total dû</th><th>Payé</th><th>Solde</th></tr></thead><tbody>
        {rows?.map((r) => <tr key={r.eleve_id}><td>{r.nom} {r.prenom}</td><td>{r.niveau || '—'}</td><td>{money(r.total_du)}</td><td>{money(r.total_paye)}</td><td><Pill kind="bad">{money(r.solde)}</Pill></td></tr>)}
        {rows?.length === 0 && <tr><td colSpan="5" className="empty">Aucun impayé.</td></tr>}</tbody></table></div>
    </div>
  );
}

export default function Paiements() {
  const { user } = useAuth();
  const staff = ['admin', 'comptable'].includes(user.role);
  const [tab, setTab] = useState('paiements');
  const [enfants, setEnfants] = useState([]);
  useEffect(() => { if (user.role === 'parent') api('/dashboard').then((d) => setEnfants(d.enfants)); }, [user.role]);
  return (
    <div>
      {staff && <div className="tabs" role="tablist"><button role="tab" aria-selected={tab === 'paiements'} onClick={() => setTab('paiements')}>Paiements</button><button role="tab" aria-selected={tab === 'impayes'} onClick={() => setTab('impayes')}>Impayés & relances</button></div>}
      {user.role === 'parent' && <div className="grid" style={{ marginBottom: '1rem' }}>{enfants.map((e) => <div key={e.id} className="stat"><b style={{ color: e.solde > 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(e.solde)}</b><span>Solde de {e.prenom}</span></div>)}</div>}
      {tab === 'impayes' ? <Impayes /> : (
        <CrudPage title="Paiements" endpoint="/paiements" annee canWrite={staff}
          hint={staff ? "À l'enregistrement : un reçu PDF est généré et un message est envoyé automatiquement au parent (solde mis à jour)." : null}
          columns={[{ key: 'numero_recu', label: 'Reçu' }, { key: 'eleve_nom', label: 'Élève' }, { key: 'tarif_libelle', label: 'Libellé' }, { label: 'Montant', render: (r) => money(r.montant) }, { label: 'Mode', render: (r) => MODES.find((m) => m.value === r.mode)?.label }, { label: 'Date', render: (r) => fmtDate(r.date_paiement) }]}
          fields={[{ name: 'eleve_id', label: 'Élève', type: 'select', optionsFrom: opt.eleve, required: true }, { name: 'tarif_id', label: 'Tarif concerné', type: 'select', optionsFrom: opt.tarif },
            { name: 'montant', label: 'Montant (TND)', type: 'number', step: '0.01', min: 0.01, max: 100000, required: true }, { name: 'mode', label: 'Mode de paiement', type: 'select', options: MODES, required: true },
            { name: 'date_paiement', label: 'Date', type: 'date', max: new Date().toISOString().slice(0, 10), help: 'Pas de date future.' }, { name: 'reference', label: 'Référence (obligatoire pour virement / mobile)', maxLength: 60, pattern: '[\\p{L}\\p{N}][\\p{L}\\p{N} ._\\/\\-]*', title: 'Lettres, chiffres, espaces et . _ / -' }, { name: 'notes', label: 'Notes', type: 'textarea', full: true, maxLength: 500 }]}
          defaults={{ mode: 'especes', date_paiement: new Date().toISOString().slice(0, 10) }}
          rowActions={(r) => <button className="btn sec sm" onClick={() => download(`/paiements/${r.id}/recu`, `${r.numero_recu}.pdf`, true).catch((e) => alert(e.message))}>Reçu PDF</button>} />)}
    </div>
  );
}

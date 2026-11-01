import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Pill } from '../components/ui.jsx';

const AUD = { tous: 'Tous', parents: 'Parents', enseignants: 'Enseignants', eleves: 'Élèves' };
export default function Annonces() {
  const { user } = useAuth();
  const [list, setList] = useState([]); const [f, setF] = useState({ titre: '', corps: '', audience: 'tous' }); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const load = () => api('/annonces').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const publish = async (e) => {
    e.preventDefault(); setErr(''); setOk('');
    if (!window.confirm('Une annonce publiée ne pourra plus être modifiée ni supprimée. Publier ?')) return;
    try { await api('/annonces', { method: 'POST', body: f }); setF({ titre: '', corps: '', audience: 'tous' }); setOk('Annonce publiée.'); load(); } catch (x) { setErr(x.message); }
  };
  return (
    <div>
      <h1>Annonces</h1>
      {user.role === 'admin' && <form className="card" onSubmit={publish}>
        <h2>Publier une annonce</h2>
        <div className="form-grid"><div><label htmlFor="t">Titre *</label><input id="t" required minLength={3} maxLength={120} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></div>
          <div><label htmlFor="a">Destinataires</label><select id="a" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="full"><label htmlFor="c">Contenu *</label><textarea id="c" required minLength={3} maxLength={5000} value={f.corps} onChange={(e) => setF({ ...f, corps: e.target.value })} /></div></div>
        <p className="muted small">Les annonces sont immuables : en cas d'erreur, publiez une annonce corrective.</p>
        <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
        <button className="btn">Publier</button></form>}
      {list.length === 0 && <div className="card empty">Aucune annonce pour le moment.</div>}
      {list.map((a) => <article key={a.id} className="card"><div className="row between"><h3>{a.titre}</h3><Pill>{AUD[a.audience]}</Pill></div><p style={{ whiteSpace: 'pre-wrap' }}>{a.corps}</p><div className="muted small">{a.auteur_nom} – {fmtDateTime(a.created_at)}</div></article>)}
    </div>
  );
}

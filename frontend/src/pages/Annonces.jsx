import { useEffect, useState } from 'react';
import { api, fmtDateTime, ROLES } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../auth.jsx';
import { Alert, Pill } from '../components/ui.jsx';

const AUD = { tous: 'Tout le monde', personne: 'Personnalisée', eleves: 'Élèves', enseignants: 'Enseignants', parents: 'Parents' };
// Choix proposés à l'envoi
const CHOIX = [['personne', 'Personne personnalisée'], ['eleves', 'Tous les élèves'], ['enseignants', 'Tous les enseignants'], ['parents', 'Tous les parents']];
const VIDE = { titre: '', corps: '', audience: 'eleves', destinataire_ids: [] };
export default function Annonces() {
  const { user } = useAuth();
  const [list, setList] = useState([]); const [f, setF] = useState(VIDE); const [users, setUsers] = useState([]); const [pick, setPick] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const load = () => api('/annonces').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (user.role === 'admin') api('/users').then((l) => setUsers(l.filter((u) => u.actif && u.role !== 'superadmin' && u.id !== user.id))).catch(() => {}); }, [user.role, user.id]);
  const nom = (id) => { const u = users.find((x) => x.id === id); return u ? `${u.nom_complet} (${ROLES[u.role]})` : `#${id}`; };
  const publish = async (e) => {
    e.preventDefault(); setErr(''); setOk('');
    if (f.audience === 'personne' && f.destinataire_ids.length === 0) { setErr('Choisissez au moins un destinataire.'); return; }
    if (!window.confirm('Une annonce publiée ne pourra plus être modifiée ni supprimée. Publier ?')) return;
    try { await api('/annonces', { method: 'POST', body: f }); setF(VIDE); setOk('Annonce publiée.'); load(); } catch (x) { setErr(x.message); }
  };
  return (
    <div>
      <h1>Annonces</h1>
      {user.role === 'admin' && <form className="card" onSubmit={publish}>
        <h2>Publier une annonce</h2>
        <div className="form-grid"><div><label htmlFor="t">Titre *</label><input id="t" required minLength={3} maxLength={120} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></div>
          <div><label htmlFor="a">Destinataires</label><select id="a" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{CHOIX.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {f.audience === 'personne' && <div className="full"><label htmlFor="d">Personne(s) destinataire(s) *</label>
            <select id="d" value={pick} onChange={(e) => { const id = Number(e.target.value); if (id && !f.destinataire_ids.includes(id)) setF({ ...f, destinataire_ids: [...f.destinataire_ids, id] }); setPick(''); }}>
              <option value="">— Choisir une personne —</option>
              {['enseignant', 'parent', 'eleve', 'comptable', 'admin'].map((r) => { const l = users.filter((u) => u.role === r && !f.destinataire_ids.includes(u.id)); return l.length ? <optgroup key={r} label={ROLES[r]}>{l.map((u) => <option key={u.id} value={u.id}>{u.nom_complet}</option>)}</optgroup> : null; })}
            </select>
            {f.destinataire_ids.length > 0 && <ul className="chips" aria-label="Destinataires choisis">{f.destinataire_ids.map((id) => <li key={id} className="chip">{nom(id)}<button type="button" aria-label={`Retirer ${nom(id)}`} onClick={() => setF({ ...f, destinataire_ids: f.destinataire_ids.filter((x) => x !== id) })}><Icon name="x" size={14} /></button></li>)}</ul>}
          </div>}
          <div className="full"><label htmlFor="c">Contenu *</label><textarea id="c" required minLength={3} maxLength={5000} value={f.corps} onChange={(e) => setF({ ...f, corps: e.target.value })} /></div></div>
        <p className="muted small">Les annonces sont immuables : en cas d'erreur, publiez une annonce corrective.</p>
        <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
        <button className="btn">Publier</button></form>}
      {list.length === 0 && <div className="card empty">Aucune annonce pour le moment.</div>}
      {list.map((a) => <article key={a.id} className="card"><div className="row between"><h3>{a.titre}</h3><Pill>{AUD[a.audience]}</Pill></div>{a.audience === 'personne' && a.destinataires_noms && <div className="muted small">À : {a.destinataires_noms}</div>}<p style={{ whiteSpace: 'pre-wrap' }}>{a.corps}</p><div className="muted small">{a.auteur_nom} – {fmtDateTime(a.created_at)}</div></article>)}
    </div>
  );
}

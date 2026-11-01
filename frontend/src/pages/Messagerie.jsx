import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Files, Modal, Pill } from '../components/ui.jsx';
import { ROLES } from '../api.js';

function Compose({ initial = {}, onClose, onDone }) {
  const [dest, setDest] = useState([]); const [sel, setSel] = useState(initial.destinataires || []);
  const [objet, setObjet] = useState(initial.objet || ''); const [corps, setCorps] = useState(initial.corps || '');
  const [files, setFiles] = useState([]); const [filter, setFilter] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/messages/destinataires').then(setDest).catch((e) => setErr(e.message)); }, []);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const send = async (brouillon) => {
    setErr('');
    if (brouillon && !objet.trim() && !corps.trim()) return setErr('Un brouillon doit contenir au moins un objet ou un texte.');
    if (!brouillon) {
      if (!sel.length) return setErr('Choisissez au moins un destinataire.');
      if (!objet.trim()) return setErr("L'objet est obligatoire.");
      if (!corps.trim()) return setErr('Le message est obligatoire.');
    }
    if (files.length > 5) return setErr('5 pièces jointes maximum.');
    const lourd = files.find((f) => f.size > 10 * 1024 * 1024);
    if (lourd) return setErr(`« ${lourd.name} » dépasse 10 Mo.`);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('objet', objet); form.append('corps', corps); form.append('destinataires', JSON.stringify(sel)); form.append('brouillon', String(brouillon));
      if (initial.thread_id) form.append('thread_id', initial.thread_id);
      files.forEach((f) => form.append('fichiers', f));
      await api(initial.id ? `/messages/${initial.id}` : '/messages', { method: initial.id ? 'PUT' : 'POST', form });
      onDone(brouillon ? 'Brouillon enregistré.' : 'Message envoyé.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const shown = dest.filter((d) => `${d.nom} ${d.prenom} ${d.info || ''}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal title={initial.thread_id ? 'Répondre' : initial.id ? 'Modifier le brouillon' : 'Nouveau message'} onClose={onClose} wide>
      <div style={{ marginBottom: '.8rem' }}>
        <label htmlFor="flt">Destinataires ({sel.length} sélectionné(s))</label>
        <input id="flt" placeholder="Filtrer…" maxLength={100} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: '.4rem', marginTop: 4 }}>
          {shown.map((d) => <label key={d.id} style={{ fontWeight: 400 }}><input type="checkbox" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} />{d.prenom} {d.nom} <span className="muted small">– {ROLES[d.role]}{d.info ? ` (parent de ${d.info})` : ''}</span></label>)}
          {shown.length === 0 && <span className="muted">Aucun destinataire disponible pour votre rôle.</span>}
        </div></div>
      <div style={{ marginBottom: '.8rem' }}><label htmlFor="ob">Objet *</label><input id="ob" maxLength={150} value={objet} onChange={(e) => setObjet(e.target.value)} /></div>
      <div style={{ marginBottom: '.8rem' }}><label htmlFor="co">Message *</label><textarea id="co" maxLength={5000} value={corps} onChange={(e) => setCorps(e.target.value)} /></div>
      <div style={{ marginBottom: '.8rem' }}><label htmlFor="pj">Pièces jointes (PDF, images, documents – 10 Mo max)</label><input id="pj" type="file" multiple onChange={(e) => setFiles([...e.target.files])} /><div className="muted small">5 fichiers maximum.</div></div>
      <p className="muted small">Un message envoyé ne peut plus être modifié ni supprimé par l'expéditeur.</p>
      <Alert>{err}</Alert>
      <div className="row"><button className="btn" disabled={busy} onClick={() => send(false)}>Envoyer</button><button className="btn sec" disabled={busy} onClick={() => send(true)}>Enregistrer comme brouillon</button></div>
    </Modal>
  );
}

function Thread({ id, onReply, onBack }) {
  const { user } = useAuth();
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setD(null); api(`/messages/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const hide = async (mid) => { if (!window.confirm('Retirer ce message de votre boîte ? (il reste visible pour les autres parties)')) return; try { await api(`/messages/${mid}/masquer`, { method: 'POST' }); onBack(); } catch (e) { setErr(e.message); } };
  if (!d) return <div><button className="btn sec sm" onClick={onBack}>← Retour</button><Alert>{err}</Alert></div>;
  const last = d.messages[d.messages.length - 1];
  return (
    <div className="card">
      <div className="row between"><button className="btn sec sm" onClick={onBack}>← Retour</button>
        <button className="btn sm" onClick={() => onReply({ thread_id: d.thread, objet: last.objet.startsWith('Re:') ? last.objet : `Re: ${last.objet}`, destinataires: last.sender_id !== user.id ? [last.sender_id] : last.destinataires_ids || [] })}>Répondre</button></div>
      <h2 style={{ marginTop: '.6rem' }}>{d.messages[0].objet}</h2>
      <Alert>{err}</Alert>
      {d.messages.map((m) => (
        <div key={m.id} className={`msg ${m.sender_id === user.id ? 'mine' : ''}`}>
          <div className="small muted"><b>{m.sender_nom}</b> → {m.destinataires_noms} – {fmtDateTime(m.sent_at)}
            {m.sender_id !== user.id && <button className="btn sec sm" style={{ marginLeft: 8 }} onClick={() => hide(m.id)}>Masquer pour moi</button>}</div>
          <div>{m.corps}</div><Files list={m.attachments} />
        </div>))}
    </div>
  );
}

export default function Messagerie() {
  const { id } = useParams(); const nav = useNavigate();
  const [box, setBox] = useState('inbox'); const [list, setList] = useState(null); const [compose, setCompose] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const load = () => api(`/messages?box=${box}`).then(setList).catch((e) => { setErr(e.message); setList([]); });
  useEffect(() => { load(); }, [box, id]);
  const BOXES = [['inbox', 'Réception'], ['sent', 'Envoyés'], ['drafts', 'Brouillons'], ['historique', 'Historique']];
  const done = (t) => { setCompose(null); setMsg(t); load(); if (id) nav('/messagerie'); };
  return (
    <div>
      <div className="row between"><h1>Messagerie</h1><button className="btn" onClick={() => setCompose({})}>+ Nouveau message</button></div>
      <Alert kind="ok">{msg}</Alert><Alert>{err}</Alert>
      {id ? <Thread id={id} onReply={setCompose} onBack={() => nav('/messagerie')} /> : <>
        <div className="tabs" role="tablist">{BOXES.map(([k, l]) => <button key={k} role="tab" aria-selected={box === k} onClick={() => setBox(k)}>{l}</button>)}</div>
        {box === 'historique' && <p className="muted small">Historique en lecture seule de toutes vos conversations (y compris les messages masqués).</p>}
        <div className="table-wrap"><table><thead><tr><th>{box === 'inbox' || box === 'historique' ? 'De' : 'À'}</th><th>Objet</th><th>Date</th><th>Actions</th></tr></thead><tbody>
          {list?.map((m) => (
            <tr key={m.id} style={{ fontWeight: box === 'inbox' && !m.read_at ? 700 : 400 }}>
              <td>{box === 'inbox' || box === 'historique' ? m.sender_nom : (m.destinataires_noms || '—')}</td>
              <td>{m.objet} {m.attachments?.length > 0 && '📎'} {box === 'inbox' && !m.read_at && <Pill kind="warn">nouveau</Pill>}</td>
              <td>{fmtDateTime(m.sent_at || m.created_at)}</td>
              <td><div className="row">
                {box === 'drafts' ? <>
                  <button className="btn sec sm" onClick={() => setCompose({ id: m.id, objet: m.objet, corps: m.corps, destinataires: m.draft_recipients, thread_id: m.thread_id })}>Modifier</button>
                  <button className="btn sm" onClick={async () => { try { await api(`/messages/${m.id}/envoyer`, { method: 'POST' }); setMsg('Message envoyé.'); load(); } catch (e) { setErr(e.message); } }}>Envoyer</button>
                  <button className="btn danger sm" onClick={async () => { if (window.confirm('Supprimer ce brouillon ?')) { await api(`/messages/${m.id}`, { method: 'DELETE' }); load(); } }}>Supprimer</button></>
                  : <button className="btn sec sm" onClick={() => nav(`/messagerie/${m.id}`)}>Ouvrir</button>}</div></td></tr>))}
          {list?.length === 0 && <tr><td colSpan="4" className="empty">Aucun message.</td></tr>}</tbody></table></div></>}
      {compose && <Compose initial={compose} onClose={() => setCompose(null)} onDone={done} />}
    </div>
  );
}

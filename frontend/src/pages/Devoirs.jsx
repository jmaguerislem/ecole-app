import { useEffect, useRef, useState } from 'react';
import { api, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Field, Files, Modal, PageHeader, Pill, Spinner } from '../components/ui.jsx';

const STATUT = { a_faire: ['warn', 'À faire'], rendu: ['ok', 'Rendu'], en_retard: ['bad', 'Rendu en retard'], note: ['ok', 'Noté'], non_rendu: ['bad', 'Non rendu'] };
const toLocal = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// ---------- Vue élève / parent ----------
function DevoirCard({ d, role, eleveId, reload }) {
  const [files, setFiles] = useState([]); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const input = useRef();
  const late = new Date() > new Date(d.date_remise);
  const deposer = async () => {
    setErr(''); setOk('');
    const form = new FormData(); files.forEach((f) => form.append('fichiers', f));
    try { const r = await api(`/devoirs/${d.id}/depot`, { method: 'POST', form }); setOk(r.en_retard ? 'Travail déposé (en retard).' : 'Travail déposé.'); setFiles([]); input.current.value = ''; reload(); } catch (e) { setErr(e.message); }
  };
  const [kind, label] = STATUT[d.statut] || ['', d.statut];
  return (
    <article className="card">
      <div className="row between"><h3>{d.titre} <span className="muted">– {d.matiere_nom}</span></h3><Pill kind={kind}>{label}</Pill></div>
      <p className="muted small">À rendre avant le {fmtDateTime(d.date_remise)} – barème /{d.bareme}</p>
      {d.description && <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>}
      <Files list={d.fichiers} />
      {d.depot_fichiers?.length > 0 && <div><b className="small">Travail déposé le {fmtDateTime(d.deposited_at)} :</b><Files list={d.depot_fichiers} /></div>}
      {d.note !== null && d.note !== undefined && <p><b>Note : {d.note} / {d.bareme}</b>{d.commentaire && <> – « {d.commentaire} »</>}</p>}
      {d.correction && <div><b className="small">Correction :</b><Files list={[d.correction]} /></div>}
      {role === 'eleve' && (d.note === null || d.note === undefined) && !(late && d.depot_id) && <div className="row" style={{ marginTop: '.5rem' }}>
        <input ref={input} aria-label="Fichiers du travail" type="file" multiple style={{ maxWidth: 320 }} onChange={(e) => setFiles([...e.target.files])} />
        <button className="btn sm" disabled={!files.length} onClick={deposer}>{d.depot_id ? 'Remplacer mon dépôt' : 'Déposer mon travail'}</button></div>}
      {role === 'parent' && !d.vu && <button className="btn sec sm" style={{ marginTop: '.5rem' }} onClick={async () => { await api(`/devoirs/${d.id}/vu`, { method: 'POST', body: { eleve_id: Number(eleveId) } }); reload(); }}>Marquer comme vu</button>}
      {role === 'parent' && d.vu && <span className="muted small"><Icon name="check" size={14} /> Vu</span>}
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
    </article>
  );
}
function DevoirsFamille({ role }) {
  const [eleves, setEleves] = useState([]); const [eid, setEid] = useState(''); const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/eleves').then((l) => { setEleves(l); if (l[0]) setEid(String(l[0].id)); else setList([]); }).catch((e) => setErr(e.message)); }, []);
  const load = () => eid && api(`/devoirs?eleve_id=${eid}`).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [eid]);
  return (
    <div>
      <PageHeader title="Devoirs" />
      {eleves.length > 1 && <div style={{ marginBottom: '1rem', maxWidth: 320 }}><label htmlFor="en">Enfant</label><select id="en" value={eid} onChange={(e) => setEid(e.target.value)}>{eleves.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}</select></div>}
      <Alert>{err}</Alert>
      {list?.length === 0 && <div className="card empty">Aucun devoir pour le moment.</div>}
      {list?.map((d) => <DevoirCard key={d.id} d={d} role={role} eleveId={eid} reload={load} />)}
    </div>
  );
}

// ---------- Vue enseignant / admin ----------
function Depots({ devoir, onClose }) {
  const [data, setData] = useState(null); const [g, setG] = useState({}); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const load = () => api(`/devoirs/${devoir.id}/depots`).then((d) => { setData(d); setG(Object.fromEntries(d.depots.map((x) => [x.eleve_id, { note: x.note ?? '', commentaire: x.commentaire ?? '' }]))); });
  useEffect(() => { load(); }, []);
  const noter = async (x) => {
    setErr(''); setOk('');
    try { await api(`/devoirs/depots/${x.depot_id}`, { method: 'PUT', body: g[x.eleve_id] }); setOk(`Note de ${x.prenom} ${x.nom} publiée.`); load(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={`Travaux rendus – ${devoir.titre}`} onClose={onClose} wide>
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
      <div className="table-wrap"><table><thead><tr><th>Élève</th><th>Statut</th><th>Dépôt</th><th>Note /{devoir.bareme}</th><th>Commentaire</th><th></th></tr></thead><tbody>
        {data?.depots.map((x) => { const [k, l] = STATUT[x.statut]; return (
          <tr key={x.eleve_id}><td>{x.nom} {x.prenom}</td><td><Pill kind={k}>{l}</Pill></td>
            <td>{x.depot_id ? <><div className="small">{fmtDateTime(x.deposited_at)}</div><Files list={x.fichiers} /></> : '—'}</td>
            <td>{x.depot_id && <input aria-label={`Note ${x.nom}`} type="number" step="0.25" min="0" max={devoir.bareme} style={{ width: 90 }} value={g[x.eleve_id]?.note ?? ''} onChange={(e) => setG((s) => ({ ...s, [x.eleve_id]: { ...s[x.eleve_id], note: e.target.value } }))} />}</td>
            <td>{x.depot_id && <input aria-label={`Commentaire ${x.nom}`} maxLength={500} value={g[x.eleve_id]?.commentaire ?? ''} onChange={(e) => setG((s) => ({ ...s, [x.eleve_id]: { ...s[x.eleve_id], commentaire: e.target.value } }))} />}</td>
            <td>{x.depot_id && <button className="btn sm" onClick={() => noter(x)}>Noter</button>}</td></tr>); })}</tbody></table></div>
    </Modal>
  );
}
function DevoirForm({ initial, onClose, onDone }) {
  const [classes, setClasses] = useState([]); const [matieres, setMatieres] = useState([]);
  const [v, setV] = useState({ titre: '', description: '', matiere_id: '', classe_id: '', date_remise: '', bareme: 20, ...(initial ? { ...initial, date_remise: toLocal(initial.date_remise) } : {}) });
  const [files, setFiles] = useState([]); const [remove, setRemove] = useState([]); const [err, setErr] = useState('');
  useEffect(() => { api('/classes').then(setClasses); api('/matieres').then(setMatieres); }, []);
  const save = async (e) => {
    e.preventDefault(); setErr('');
    const form = new FormData();
    ['titre', 'description', 'bareme'].forEach((k) => form.append(k, v[k] ?? ''));
    form.append('date_remise', new Date(v.date_remise).toISOString());
    if (!initial) { form.append('matiere_id', v.matiere_id); form.append('classe_id', v.classe_id); }
    if (remove.length) form.append('remove_files', JSON.stringify(remove));
    files.forEach((f) => form.append('fichiers', f));
    try { await api(initial ? `/devoirs/${initial.id}` : '/devoirs', { method: initial ? 'PUT' : 'POST', form }); onDone(initial ? 'Devoir modifié.' : 'Devoir publié : élèves et parents notifiés.'); } catch (x) { setErr(x.message); }
  };
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Modal title={initial ? 'Modifier le devoir' : 'Nouveau devoir'} onClose={onClose}>
      <form onSubmit={save}><div className="form-grid">
        <Field f={{ name: 'titre', label: 'Titre', required: true, full: true, minLength: 2, maxLength: 120 }} value={v.titre} onChange={set('titre')} />
        <Field f={{ name: 'description', label: 'Description', type: 'textarea', full: true, maxLength: 2000 }} value={v.description} onChange={set('description')} />
        {!initial && <><Field f={{ name: 'classe_id', label: 'Classe', type: 'select', required: true }} value={v.classe_id} onChange={set('classe_id')} options={classes.map((c) => ({ value: c.id, label: c.nom }))} />
          <Field f={{ name: 'matiere_id', label: 'Matière', type: 'select', required: true }} value={v.matiere_id} onChange={set('matiere_id')} options={matieres.map((m) => ({ value: m.id, label: m.nom }))} /></>}
        <Field f={{ name: 'date_remise', label: 'Date de remise', type: 'datetime-local', required: true, ...(initial ? {} : { min: toLocal(new Date()) }), help: initial ? undefined : 'Doit être dans le futur.' }} value={v.date_remise} onChange={set('date_remise')} />
        <Field f={{ name: 'bareme', label: 'Barème (sur)', type: 'number', step: '0.5', min: 1, max: 100, required: true }} value={v.bareme} onChange={set('bareme')} />
        <div className="full"><label htmlFor="pj">Pièces jointes</label><input id="pj" type="file" multiple onChange={(e) => setFiles([...e.target.files])} />
          {initial?.fichiers?.filter((f) => !remove.includes(f.name)).map((f) => <div key={f.name} className="small"><Icon name="paperclip" size={14} /> {f.original} <button type="button" className="btn danger sm" onClick={() => setRemove((r) => [...r, f.name])}>Retirer</button></div>)}</div>
      </div><Alert>{err}</Alert><div className="row" style={{ marginTop: '1rem' }}><button className="btn">Enregistrer</button><button type="button" className="btn sec" onClick={onClose}>Annuler</button></div></form>
    </Modal>
  );
}
function DevoirsStaff() {
  const [list, setList] = useState(null); const [modal, setModal] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const corr = useRef(); const [corrFor, setCorrFor] = useState(null);
  const load = () => api('/devoirs').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (d) => {
    if (!window.confirm('Supprimer ce devoir ?')) return;
    try { await api(`/devoirs/${d.id}`, { method: 'DELETE' }); load(); } catch (e) {
      if (e.data?.confirmable && window.confirm(e.message)) { await api(`/devoirs/${d.id}?force=true`, { method: 'DELETE' }); load(); } else setErr(e.message); }
  };
  const uploadCorr = async (e) => {
    const f = e.target.files[0]; if (!f || !corrFor) return;
    const form = new FormData(); form.append('correction', f);
    try { await api(`/devoirs/${corrFor}/correction`, { method: 'POST', form }); setMsg('Correction envoyée (visible après la date de remise).'); load(); } catch (x) { setErr(x.message); }
    e.target.value = '';
  };
  return (
    <div>
      <PageHeader title="Devoirs"><button type="button" className="btn" onClick={() => setModal({ type: 'form' })}><Icon name="plus" size={16} />Nouveau devoir</button></PageHeader>
      <Alert>{err}</Alert><Alert kind="ok">{msg}</Alert>
      <input ref={corr} type="file" hidden onChange={uploadCorr} />
      <div className="table-wrap"><table><thead><tr><th>Devoir</th><th>Classe</th><th>Matière</th><th>Remise</th><th>Dépôts</th><th>Actions</th></tr></thead><tbody>
        {list?.map((d) => <tr key={d.id}><td>{d.titre}<Files list={d.fichiers} />{d.a_correction && <Pill kind="ok">corrigé joint</Pill>}</td><td>{d.classe_nom}</td><td>{d.matiere_nom}</td><td>{fmtDateTime(d.date_remise)}</td><td>{d.nb_depots}/{d.nb_eleves}</td>
          <td><div className="row"><button className="btn sm" onClick={() => setModal({ type: 'depots', d })}>Travaux rendus</button><button className="btn sec sm" onClick={() => { setCorrFor(d.id); corr.current.click(); }}>Correction</button>
            <button className="btn sec sm" onClick={() => setModal({ type: 'form', d })}>Modifier</button><button className="btn danger sm" onClick={() => remove(d)}>Supprimer</button></div></td></tr>)}
        {list?.length === 0 && <tr><td colSpan="6" className="empty">Aucun devoir. Utilisez « Nouveau devoir ».</td></tr>}</tbody></table></div>
      {modal?.type === 'form' && <DevoirForm initial={modal.d} onClose={() => setModal(null)} onDone={(t) => { setModal(null); setMsg(t); load(); }} />}
      {modal?.type === 'depots' && <Depots devoir={modal.d} onClose={() => { setModal(null); load(); }} />}
    </div>
  );
}

export default function Devoirs() {
  const { user } = useAuth();
  return ['admin', 'enseignant'].includes(user.role) ? <DevoirsStaff /> : <DevoirsFamille role={user.role} />;
}

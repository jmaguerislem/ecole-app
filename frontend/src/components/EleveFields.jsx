import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import { Alert, PasswordInput } from './ui.jsx';
import { NOM, EMAIL, MOT_DE_PASSE } from '../rules.js';

const NEW = '__new__';
const NIVEAUX = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année'];
const label = (f, required) => <label htmlFor={`f-${f.name}`}>{f.label}{required && <span className="req" aria-hidden="true"> *</span>}</label>;

// ---------- Image protégée (le JWT est dans l'en-tête : on passe par fetch + URL d'objet) ----------
const cache = new Map();
export function AuthImage({ src, alt = '', className, fallback = null }) {
  const [url, setUrl] = useState(() => (src && !src.startsWith('/api/') ? src : cache.get(src) || null));
  const [fail, setFail] = useState(false);
  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    if (!src.startsWith('/api/')) { setUrl(src); return undefined; }
    if (cache.has(src)) { setUrl(cache.get(src)); return undefined; }
    let alive = true;
    fetch(src, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { const u = URL.createObjectURL(b); cache.set(src, u); if (alive) setUrl(u); })
      .catch(() => alive && setFail(true));
    return () => { alive = false; };
  }, [src]);
  if (!src || fail || !url) return fallback;
  return <img src={url} alt={alt} className={className} onError={() => setFail(true)} />;
}

// ---------- Mots de passe : saisie + confirmation (jamais affichés en clair, jamais renvoyés) ----------
export function PasswordConfirmField({ f, value, onChange, form, editing }) {
  const pw = form?.[f.confirmOf] || '';
  const filled = !!value;
  const ok = filled && value === pw;
  return <>
    {label(f, !editing || !!pw)}
    <input id={`f-${f.name}`} name={f.name} type="password" autoComplete="new-password" maxLength={128} required={!!pw || !editing} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-describedby={`f-${f.name}-st`} aria-invalid={filled && !ok} />
    <div className={`help pw-match ${filled ? (ok ? 'ok' : 'bad') : ''}`} id={`f-${f.name}-st`} role="status" aria-live="polite">
      {filled ? (ok ? '✓ Les mots de passe correspondent.' : '✗ Les mots de passe ne correspondent pas.') : 'Saisissez à nouveau le mot de passe.'}
    </div>
  </>;
}
export const verifierMotsDePasse = (form, row) => {
  if (!form.password && !row) return 'Le mot de passe est obligatoire.';
  if ((form.password || form.password_confirm) && form.password !== form.password_confirm) return 'La confirmation du mot de passe ne correspond pas.';
  return null;
};
export const PASSWORD_FIELDS = [
  { name: 'password', label: 'Mot de passe', type: 'password', requiredOnCreate: true, help: 'Laisser vide pour ne pas changer. 8 caractères minimum, avec une lettre et un chiffre.', ...MOT_DE_PASSE },
  { name: 'password_confirm', label: 'Confirmer le mot de passe', type: 'password', confirmOf: 'password', render: (p) => <PasswordConfirmField {...p} /> },
];

// Mot de passe du compte de connexion de l'élève (identifiant = l'e-mail ci-dessous, créé automatiquement) :
// obligatoire avec confirmation à l'ajout ; à la modification, vide = inchangé.
export const ELEVE_PASSWORD_FIELDS = [
  { name: 'password', label: 'Mot de passe', type: 'password', requiredOnCreate: true, ...MOT_DE_PASSE,
    render: (p) => <ElevePasswordField {...p} /> },
  { name: 'password_confirm', label: 'Confirmer le mot de passe', type: 'password', confirmOf: 'password', sendConfirm: true, requiredOnCreate: true, render: (p) => <PasswordConfirmField {...p} /> }, // la confirmation est aussi revérifiée par le serveur
];
function ElevePasswordField({ f, value, onChange, editing }) {
  const hasAccount = !!editing?.user_id;
  return <>
    {label(f, !editing)}
    <PasswordInput id={`f-${f.name}`} name={f.name} required={!editing} minLength={f.minLength} maxLength={f.maxLength} pattern={f.pattern} title={f.title}
      autoComplete="new-password" aria-describedby={`f-${f.name}-h`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    <div className="help" id={`f-${f.name}-h`}>
      {!editing && "Mot de passe de connexion de l'élève (son e-mail sert d'identifiant). 8 caractères minimum, avec une lettre et un chiffre. Il est enregistré haché."}
      {editing && hasAccount && 'Laisser vide pour conserver le mot de passe actuel. Sinon : 8 caractères minimum, avec une lettre et un chiffre.'}
      {editing && !hasAccount && "Cet élève n'a pas encore de compte de connexion : saisissez un mot de passe pour le créer (8 caractères minimum, une lettre et un chiffre)."}
    </div>
  </>;
}

// ---------- E-mail de l'élève : généré par le serveur, affiché en lecture seule ----------
export function EmailEleveField({ f, form, editing }) {
  const [sugg, setSugg] = useState('');
  const { nom, prenom, date_naissance } = form;
  useEffect(() => {
    if (editing?.email || !nom || !prenom) { setSugg(''); return undefined; }
    const t = setTimeout(() => api(`/eleves/email-suggestion?${new URLSearchParams({ nom, prenom, date_naissance: date_naissance || '' })}`).then((r) => setSugg(r.email)).catch(() => setSugg('')), 350);
    return () => clearTimeout(t);
  }, [nom, prenom, date_naissance, editing]);
  const shown = editing?.email || sugg;
  return <>
    {label(f)}
    <input id={`f-${f.name}`} type="email" readOnly value={shown || ''} placeholder="Généré à partir du nom et du prénom" aria-describedby={`f-${f.name}-h`} />
    <div className="help" id={`f-${f.name}-h`}>{editing?.email ? 'Adresse unique générée automatiquement : elle ne change pas.' : 'Générée automatiquement (prénom.nom), unique ; confirmée à l’enregistrement.'}</div>
  </>;
}

// ---------- Classe : liste + « Ajouter une classe » ----------
export function ClassePicker({ f, value, onChange, options = [], reloadOptions }) {
  const { user } = useAuth();
  const canCreate = user.role === 'admin';
  const [mode, setMode] = useState(false);
  const [n, setN] = useState({ niveau: '', section: '', capacite: 25 });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pick = (v) => { if (v === NEW) { setMode(true); setErr(''); } else { setMode(false); onChange(v); } };
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const c = await api('/classes', { method: 'POST', body: { niveau: n.niveau, section: n.section, capacite: Number(n.capacite) } });
      await reloadOptions(); onChange(c.id); setMode(false); setN({ niveau: '', section: '', capacite: 25 });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <>
    {label(f)}
    <select id={`f-${f.name}`} value={mode ? NEW : value ?? ''} onChange={(e) => pick(e.target.value)}>
      <option value="">— Aucune —</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {canCreate && <option value={NEW}>➕ Ajouter une classe…</option>}
    </select>
    {mode && <fieldset className="inline-create" aria-label="Nouvelle classe">
      <legend>Nouvelle classe</legend>
      <div className="form-grid">
        <div><label htmlFor="nc-niveau">Niveau *</label><select id="nc-niveau" value={n.niveau} onChange={(e) => setN({ ...n, niveau: e.target.value })}><option value="">— Choisir —</option>{NIVEAUX.map((v) => <option key={v}>{v}</option>)}</select></div>
        <div><label htmlFor="nc-section">Section (A, B…)</label><input id="nc-section" maxLength={3} pattern="[A-Za-z0-9]{1,3}" value={n.section} onChange={(e) => setN({ ...n, section: e.target.value.toUpperCase() })} /></div>
        <div><label htmlFor="nc-cap">Capacité *</label><input id="nc-cap" type="number" min={1} max={50} step={1} value={n.capacite} onChange={(e) => setN({ ...n, capacite: e.target.value })} /></div>
      </div>
      <Alert>{err}</Alert>
      <div className="row"><button type="button" className="btn sm" disabled={busy || !n.niveau} onClick={create}>{busy ? 'Création…' : 'Créer la classe'}</button><button type="button" className="btn sec sm" onClick={() => { setMode(false); setErr(''); }}>Annuler</button></div>
    </fieldset>}
  </>;
}

// ---------- Parents : liste de parents existants + « Ajouter un parent » ----------
export function ParentPicker({ f, value, onChange, options = [], reloadOptions }) {
  const { user } = useAuth();
  const canCreate = user.role === 'admin';
  const ids = (value || []).map(Number);
  const [mode, setMode] = useState(false);
  const empty = { nom: '', prenom: '', email: '', telephone: '', password: '', password_confirm: '' };
  const [n, setN] = useState(empty); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const name = (id) => options.find((o) => o.value === id)?.label || `Parent #${id}`;
  const pick = (v) => { if (v === NEW) { setMode(true); setErr(''); } else if (v && !ids.includes(Number(v))) onChange([...ids, Number(v)]); };
  const create = async () => {
    setErr('');
    if (n.password !== n.password_confirm) { setErr('La confirmation du mot de passe ne correspond pas.'); return; }
    setBusy(true);
    try {
      const u = await api('/users', { method: 'POST', body: { ...n, role: 'parent' } }); // le serveur revérifie la confirmation
      await reloadOptions(); if (ids.length < 4) onChange([...ids, u.id]); setMode(false); setN(empty);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setN({ ...n, [k]: e.target.value });
  return <>
    {label(f)}
    <select id={`f-${f.name}`} value="" onChange={(e) => pick(e.target.value)} disabled={ids.length >= 4}>
      <option value="">{ids.length >= 4 ? '4 parents maximum' : '— Sélectionner un parent enregistré —'}</option>
      {options.filter((o) => !ids.includes(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {canCreate && <option value={NEW}>➕ Ajouter un parent…</option>}
    </select>
    {ids.length > 0 && <ul className="chips" aria-label="Parents sélectionnés">{ids.map((id) => <li key={id} className="chip">{name(id)}<button type="button" aria-label={`Retirer ${name(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}><Icon name="x" size={14} /></button></li>)}</ul>}
    {mode && <fieldset className="inline-create" aria-label="Nouveau parent">
      <legend>Nouveau parent</legend>
      <div className="form-grid">
        <div><label htmlFor="np-nom">Nom *</label><input id="np-nom" required {...NOM} value={n.nom} onChange={set('nom')} /></div>
        <div><label htmlFor="np-prenom">Prénom *</label><input id="np-prenom" required {...NOM} value={n.prenom} onChange={set('prenom')} /></div>
        <div><label htmlFor="np-email">E-mail (identifiant) *</label><input id="np-email" type="email" required {...EMAIL} value={n.email} onChange={set('email')} /></div>
        <div><label htmlFor="np-tel">Téléphone</label><input id="np-tel" type="tel" inputMode="numeric" maxLength={8} pattern="[0-9]{8}" placeholder="8 chiffres" value={n.telephone} onChange={set('telephone')} /></div>
        <div><label htmlFor="np-pw">Mot de passe *</label><input id="np-pw" type="password" required {...MOT_DE_PASSE} autoComplete="new-password" value={n.password} onChange={set('password')} /></div>
        <div><label htmlFor="np-pw2">Confirmer le mot de passe *</label><input id="np-pw2" type="password" required maxLength={128} autoComplete="new-password" value={n.password_confirm} onChange={set('password_confirm')} aria-invalid={!!n.password_confirm && n.password !== n.password_confirm} /></div>
      </div>
      <Alert>{err}</Alert>
      <div className="row"><button type="button" className="btn sm" disabled={busy || !n.nom || !n.prenom || !n.email || !n.password} onClick={create}>{busy ? 'Création…' : 'Créer le parent'}</button><button type="button" className="btn sec sm" onClick={() => { setMode(false); setErr(''); }}>Annuler</button></div>
    </fieldset>}
  </>;
}

// ---------- Photo : fichier du PC ou capture caméra ----------
const MAX_SIDE = 800;
async function reduire(blob) { // redimensionne (800 px max) et recompresse en JPEG ; renvoie l'original si le navigateur ne sait pas le lire
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', 0.85));
  } catch { return blob; }
}
export function PhotoField({ f, value, onChange }) {
  const input = useRef(); const video = useRef(); const stream = useRef();
  const [cam, setCam] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stop, []);
  const envoyer = async (blob) => {
    setBusy(true); setErr('');
    try {
      const img = await reduire(blob);
      const form = new FormData(); form.append('photo', img, 'photo.jpg');
      const r = await api('/eleves/photo', { method: 'POST', form });
      onChange(r.photo);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const fichier = (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setErr('Format non pris en charge : utilisez une image JPEG, PNG ou WebP.'); return; }
    if (file.size > 15 * 1024 * 1024) { setErr('Image trop volumineuse (15 Mo maximum).'); return; }
    envoyer(file);
  };
  const ouvrirCamera = async () => {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr("La caméra n'est pas disponible (connexion HTTPS requise) : utilisez « Choisir un fichier »."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      setCam(true);
      setTimeout(() => { if (video.current) { video.current.srcObject = stream.current; video.current.play().catch(() => {}); } }, 0);
    } catch { setErr("Accès à la caméra refusé ou indisponible : autorisez-la dans le navigateur ou utilisez « Choisir un fichier »."); }
  };
  const capturer = () => {
    const v = video.current; if (!v?.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((b) => { stop(); setCam(false); if (b) envoyer(b); }, 'image/jpeg', 0.9);
  };
  const fermer = () => { stop(); setCam(false); };
  return <>
    <span className="lbl" id="photo-lbl">{f.label}</span>
    <div className="photo-field" role="group" aria-labelledby="photo-lbl">
      <div className="photo-preview">{value ? <AuthImage src={value} alt="Photo de l'élève" fallback={<span className="muted small">Image indisponible</span>} /> : <Icon name="user" size={36} />}</div>
      <div className="photo-actions">
        <button type="button" className="btn sec sm" disabled={busy} onClick={() => input.current.click()}><Icon name="upload" size={14} />Choisir un fichier</button>
        <button type="button" className="btn sec sm" disabled={busy || cam} onClick={ouvrirCamera}><Icon name="camera" size={14} />Prendre une photo</button>
        {value && <button type="button" className="btn danger sm" disabled={busy} onClick={() => onChange('')}><Icon name="trash" size={14} />Retirer</button>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={fichier} />
        {busy && <span className="muted small" role="status">Envoi de la photo…</span>}
      </div>
    </div>
    {cam && <div className="cam-box"><video ref={video} playsInline muted aria-label="Aperçu de la caméra" /><div className="row"><button type="button" className="btn sm" onClick={capturer}><Icon name="camera" size={14} />Capturer</button><button type="button" className="btn sec sm" onClick={fermer}>Annuler</button></div></div>}
    <Alert>{err}</Alert>
    <div className="help">JPEG, PNG ou WebP. L'image est automatiquement réduite avant l'envoi.</div>
  </>;
}

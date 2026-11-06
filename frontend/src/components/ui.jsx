import { useEffect, useId, useRef, useState } from 'react';
import { download } from '../api.js';
import Icon from './Icon.jsx';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Boîte de dialogue accessible : focus piégé, Échap pour fermer, défilement de la page verrouillé,
// focus rendu à l'élément déclencheur. Sur mobile, elle s'affiche en « bottom sheet » (voir styles.css).
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef();
  const titleId = useId();
  // `onClose` est souvent une flèche recréée à chaque rendu du parent : on la lit via une ref pour que
  // l'effet ne se relance PAS à chaque frappe (sinon le focus sautait vers le premier champ).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    const prev = document.activeElement;
    const first = root.querySelector('.modal-body input:not([type=hidden]),.modal-body select,.modal-body textarea') || root.querySelector('.modal-body button') || root;
    first.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]; const z = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === root)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Fermer"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// L'information n'est jamais portée par la couleur seule : chaque alerte a une icône + un texte.
const ALERT_ICON = { err: 'alert-circle', ok: 'check-circle', info: 'info', warn: 'alert-triangle' };
export const Alert = ({ kind = 'err', children }) => (children ? (
  <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
    <Icon name={ALERT_ICON[kind] || 'info'} size={18} /><div>{children}</div>
  </div>
) : null);

export function FileLink({ f }) {
  return <button type="button" className="btn sec sm" onClick={() => download(`/files/${f.name}`, f.original).catch((e) => alert(e.message))}><Icon name="paperclip" size={14} />{f.original}</button>;
}
export const Files = ({ list }) => (list?.length ? <div className="files">{list.map((f) => <FileLink key={f.name} f={f} />)}</div> : null);

export function Field({ f, value, onChange, options, ...ctx }) {
  if (f.render) return <div className={f.full ? 'full' : ''}>{f.render({ f, value, onChange, options, ...ctx })}</div>; // champ personnalisé (photo, listes avec création…)
  const id = `f-${f.name}`;
  const helpId = f.help ? `${id}-help` : undefined;
  const common = { id, name: f.name, required: f.required, disabled: f.disabled, 'aria-describedby': helpId };
  const help = f.help && <div className="help" id={helpId}>{f.help}</div>;
  let input;
  switch (f.type) {
    case 'textarea': input = <textarea {...common} maxLength={f.maxLength} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'select':
      input = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? '— Choisir —' : '— Aucun —'}</option>
          {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>);
      break;
    case 'multiselect':
      input = (
        <select {...common} multiple size={5} value={(value || []).map(String)} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => Number(o.value)))}>
          {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>);
      break;
    case 'checkbox':
      return <div className={f.full ? 'full' : ''}><label className="check" htmlFor={id}><input type="checkbox" id={id} aria-describedby={helpId} checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>{help}</div>;
    default:
      input = <input {...common} type={f.type || 'text'} step={f.step} min={f.min} max={f.max} minLength={f.minLength} maxLength={f.maxLength} pattern={f.pattern} inputMode={f.inputMode} placeholder={f.placeholder} title={f.title} value={value ?? ''} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />;
  }
  return <div className={f.full ? 'full' : ''}><label htmlFor={id}>{f.label}{f.required && <span className="req" aria-hidden="true"> *</span>}</label>{input}{help}</div>;
}

export const Pill = ({ kind, children }) => <span className={`pill ${kind || ''}`}>{children}</span>;

// Champ mot de passe avec bascule afficher / masquer (cible tactile 44 px, état annoncé via aria-pressed)
export function PasswordInput({ id, value, onChange, autoComplete, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} {...rest} />
      <button type="button" className="icon-btn pw-toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
        <Icon name={show ? 'eye-off' : 'eye'} />
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export const EmptyState = ({ icon = 'inbox', title, children }) => (
  <div className="empty-state">
    <span className="empty-ico"><Icon name={icon} size={24} /></span>
    {title && <b>{title}</b>}
    {children && <span className="muted">{children}</span>}
  </div>
);

export const Spinner = ({ label = 'Chargement…' }) => <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;

// Lignes « squelette » : réservent la place du tableau pendant le chargement (pas de saut de mise en page)
export const SkeletonRows = ({ cols, rows = 4 }) => Array.from({ length: rows }, (_, i) => (
  <tr key={i} className="skeleton-row" aria-hidden="true">{Array.from({ length: cols }, (_, j) => <td key={j}><span className="skeleton" style={{ width: `${55 + ((i + j * 2) % 4) * 11}%` }} /></td>)}</tr>
));

export const initials = (...parts) => parts.filter(Boolean).map((p) => String(p).trim()[0]).join('').slice(0, 2).toUpperCase() || '?';
export const Avatar = ({ prenom, nom, size = 36 }) => (
  <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(prenom, nom)}</span>
);

// E-mail lisible : partie locale en évidence, domaine atténué, lien mailto, tronqué proprement, copie en un clic
export function EmailCell({ email }) {
  const [copied, setCopied] = useState(false);
  if (!email) return '—';
  const [local, domain] = String(email).split('@');
  const copy = async () => { try { await navigator.clipboard.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* presse-papiers indisponible */ } };
  return (
    <span className="email-cell">
      <a href={`mailto:${email}`} className="email-text" title={email}><span className="email-local">{local}</span><span className="email-domain">@{domain}</span></a>
      <button type="button" className="icon-btn email-copy" onClick={copy} aria-label={`Copier l'adresse ${email}`} title="Copier"><Icon name={copied ? 'check' : 'copy'} size={15} /></button>
      <span className="sr-only" role="status">{copied ? 'Adresse copiée' : ''}</span>
    </span>
  );
}

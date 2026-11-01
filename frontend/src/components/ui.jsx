import { useEffect, useRef } from 'react';
import { download } from '../api.js';

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={wide ? { maxWidth: 960 } : null}>
        <div className="row between"><h2>{title}</h2><button className="btn sec sm" onClick={onClose} aria-label="Fermer">✕</button></div>
        {children}
      </div>
    </div>
  );
}
export const Alert = ({ kind = 'err', children }) => (children ? <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div> : null);

export function FileLink({ f }) {
  return <button className="btn sec sm" style={{ marginRight: 4 }} onClick={() => download(`/files/${f.name}`, f.original).catch((e) => alert(e.message))}>📎 {f.original}</button>;
}
export const Files = ({ list }) => (list?.length ? <div>{list.map((f) => <FileLink key={f.name} f={f} />)}</div> : null);

export function Field({ f, value, onChange, options }) {
  const id = `f-${f.name}`;
  const common = { id, name: f.name, required: f.required, disabled: f.disabled };
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
      return <div><label><input type="checkbox" id={id} checked={!!value} onChange={(e) => onChange(e.target.checked)} />{f.label}</label></div>;
    default:
      input = <input {...common} type={f.type || 'text'} step={f.step} min={f.min} max={f.max} minLength={f.minLength} maxLength={f.maxLength} pattern={f.pattern} inputMode={f.inputMode} placeholder={f.placeholder} title={f.title} value={value ?? ''} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />;
  }
  return <div className={f.full ? 'full' : ''}><label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>{input}{f.help && <div className="muted small">{f.help}</div>}</div>;
}
export const Pill = ({ kind, children }) => <span className={`pill ${kind || ''}`}>{children}</span>;

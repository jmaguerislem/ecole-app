import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, Modal } from './ui.jsx';

// Page CRUD générique : liste + recherche + Ajouter / Modifier / Supprimer (avec confirmation des suppressions contrôlées)
export default function CrudPage({ title, endpoint, columns, fields, canWrite = true, query = {}, defaults = {}, annee = false, rowActions, toolbar, searchable = true, transformBody, hint, canEditRow, canDeleteRow }) {
  const { config } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(config.anneeCourante || '');
  const [modal, setModal] = useState(null); // {row|null}
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [opts, setOpts] = useState({});
  const [saving, setSaving] = useState(false);
  const qs = JSON.stringify(query);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ ...JSON.parse(qs), ...(search ? { q: search } : {}), ...(annee && year ? { annee: year } : {}) });
      setRows(await api(`${endpoint}?${p}`)); setError('');
    } catch (e) { setError(e.message); setRows([]); }
  }, [endpoint, qs, search, annee, year]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);

  useEffect(() => {
    fields.filter((f) => f.optionsFrom).forEach(async (f) => {
      try {
        const data = await api(f.optionsFrom.url);
        setOpts((o) => ({ ...o, [f.name]: data.map((r) => ({ value: r[f.optionsFrom.value || 'id'], label: f.optionsFrom.label(r) })) }));
      } catch { /* option indisponible pour ce rôle */ }
    });
  }, [fields]);

  const open = (row) => {
    const v = {};
    fields.forEach((f) => { v[f.name] = row ? (f.type === 'time' && row[f.name] ? String(row[f.name]).slice(0, 5) : row[f.name] ?? (f.type === 'multiselect' ? [] : '')) : defaults[f.name] ?? (f.type === 'multiselect' ? [] : f.type === 'checkbox' ? (f.default ?? false) : ''); });
    setForm(v); setFormError(''); setModal({ row });
  };
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      let body = { ...form };
      if (modal.row) fields.forEach((f) => { if (f.type === 'password' && !body[f.name]) delete body[f.name]; });
      if (transformBody) body = transformBody(body, modal.row);
      await api(modal.row ? `${endpoint}/${modal.row.id}` : endpoint, { method: modal.row ? 'PUT' : 'POST', body });
      setModal(null); setInfo(modal.row ? 'Modification enregistrée.' : 'Élément ajouté.'); load();
    } catch (err) { setFormError(err.message); } finally { setSaving(false); }
  };
  const remove = async (row) => {
    if (!window.confirm('Supprimer cet élément ?')) return;
    try { await api(`${endpoint}/${row.id}`, { method: 'DELETE' }); setInfo('Élément supprimé.'); load(); }
    catch (e) {
      if (e.data?.confirmable && window.confirm(e.message)) {
        try { await api(`${endpoint}/${row.id}?force=true`, { method: 'DELETE' }); setInfo('Élément supprimé.'); load(); } catch (e2) { setError(e2.message); }
      } else setError(e.message);
    }
  };
  const cell = (r, c) => (c.render ? c.render(r) : typeof r[c.key] === 'boolean' ? (r[c.key] ? 'Oui' : 'Non') : r[c.key] ?? '—');

  return (
    <div>
      <div className="row between"><h1>{title}</h1>
        <div className="row">{toolbar}{canWrite && <button className="btn" onClick={() => open(null)}>+ Ajouter</button>}</div></div>
      {hint && <p className="muted">{hint}</p>}
      <div className="row" style={{ margin: '.5rem 0' }}>
        {searchable && <input aria-label="Rechercher" placeholder="Rechercher…" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />}
        {annee && <input aria-label="Année scolaire" value={year} maxLength={9} pattern="(\d{4}-\d{4}|all)" title="Format 2026-2027, ou « all » pour toutes les années" onChange={(e) => setYear(e.target.value.trim())} placeholder="2026-2027 ou all" style={{ maxWidth: 160 }} />}
      </div>
      <Alert>{error}</Alert><Alert kind="ok">{info}</Alert>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}<th>Actions</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={columns.length + 1} className="empty">Chargement…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={columns.length + 1} className="empty">Aucun élément. {canWrite && 'Utilisez « Ajouter » pour commencer.'}</td></tr>}
            {rows?.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => <td key={c.label}>{cell(r, c)}</td>)}
                <td><div className="row">
                  {rowActions?.(r, load, { setInfo, setError })}
                  {canWrite && (canEditRow ? canEditRow(r) : true) && <button className="btn sec sm" onClick={() => open(r)}>Modifier</button>}
                  {canWrite && (canDeleteRow ? canDeleteRow(r) : true) && <button className="btn danger sm" onClick={() => remove(r)}>Supprimer</button>}
                </div></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.row ? `Modifier – ${title}` : `Ajouter – ${title}`} onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <div className="form-grid">
              {fields.map((f) => <Field key={f.name} f={f} value={form[f.name]} options={f.options || opts[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />)}
            </div>
            <Alert>{formError}</Alert>
            <div className="row" style={{ marginTop: '1rem' }}><button className="btn" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className="btn sec" onClick={() => setModal(null)}>Annuler</button></div>
          </form>
        </Modal>)}
    </div>
  );
}

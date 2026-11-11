import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import { Alert, EmptyState, Field, Modal, PageHeader, SkeletonRows } from './ui.jsx';

// Page CRUD générique : liste + recherche + Ajouter / Modifier / Supprimer (avec confirmation des suppressions contrôlées)
export default function CrudPage({ title, endpoint, columns, fields, canWrite = true, query = {}, defaults = {}, annee = false, rowActions, toolbar, searchable = true, transformBody, hint, canEditRow, canDeleteRow, validate, onChange, above, wideModal, successMessage }) {
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

  const loadOpts = useCallback(async (only) => {
    await Promise.all(fields.filter((f) => f.optionsFrom && (!only || f.name === only)).map(async (f) => {
      try {
        const data = await api(f.optionsFrom.url);
        setOpts((o) => ({ ...o, [f.name]: data.map((r) => ({ value: r[f.optionsFrom.value || 'id'], label: f.optionsFrom.label(r), raw: r })) }));
      } catch { /* option indisponible pour ce rôle */ }
    }));
  }, [fields]);
  useEffect(() => { loadOpts(); }, [loadOpts]);

  const open = (row) => {
    const v = {};
    fields.forEach((f) => { v[f.name] = row ? (f.type === 'time' && row[f.name] ? String(row[f.name]).slice(0, 5) : row[f.name] ?? (f.type === 'multiselect' ? [] : '')) : defaults[f.name] ?? (f.type === 'multiselect' ? [] : f.type === 'checkbox' ? (f.default ?? false) : ''); });
    setForm(v); setFormError(''); setModal({ row });
  };
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      const verr = validate?.(form, modal.row);
      if (verr) { setFormError(verr); setSaving(false); return; }
      let body = { ...form };
      fields.forEach((f) => { if (f.type === 'password' && f.confirmOf && !f.sendConfirm) delete body[f.name]; }); // confirmation vérifiée ici, et renvoyée au serveur seulement si le champ le demande (sendConfirm)
      if (modal.row) fields.forEach((f) => { if (f.type === 'password' && !body[f.name]) delete body[f.name]; });
      if (transformBody) body = transformBody(body, modal.row);
      const res = await api(modal.row ? `${endpoint}/${modal.row.id}` : endpoint, { method: modal.row ? 'PUT' : 'POST', body });
      setModal(null); setInfo(successMessage?.(res, !!modal.row) || (modal.row ? 'Modification enregistrée.' : 'Élément ajouté.')); load(); onChange?.();
    } catch (err) { setFormError(err.message); } finally { setSaving(false); }
  };
  const remove = async (row) => {
    if (!window.confirm('Supprimer cet élément ?')) return;
    try { await api(`${endpoint}/${row.id}`, { method: 'DELETE' }); setInfo('Élément supprimé.'); load(); onChange?.(); }
    catch (e) {
      if (e.data?.confirmable && window.confirm(e.message)) {
        try { await api(`${endpoint}/${row.id}?force=true`, { method: 'DELETE' }); setInfo('Élément supprimé.'); load(); onChange?.(); } catch (e2) { setError(e2.message); }
      } else setError(e.message);
    }
  };
  const cell = (r, c) => (c.render ? c.render(r) : typeof r[c.key] === 'boolean' ? (r[c.key] ? 'Oui' : 'Non') : r[c.key] ?? '—');
  const nCols = columns.length + 1;

  return (
    <div>
      <PageHeader title={title} subtitle={hint}>
        {toolbar}{canWrite && <button type="button" className="btn" onClick={() => open(null)}><Icon name="plus" size={16} />Ajouter</button>}
      </PageHeader>
      {(searchable || annee) && (
        <div className="filters">
          {searchable && <div className="search"><Icon name="search" size={18} /><input type="search" aria-label="Rechercher" placeholder="Rechercher…" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} /></div>}
          {annee && <div className="year"><input aria-label="Année scolaire" value={year} maxLength={9} pattern="(\d{4}-\d{4}|all)" title="Format 2026-2027, ou « all » pour toutes les années" onChange={(e) => setYear(e.target.value.trim())} placeholder="2026-2027 ou all" /></div>}
        </div>
      )}
      <Alert>{error}</Alert><Alert kind="ok">{info}</Alert>
      {above}
      <div className="table-wrap stack">
        <table role="table">
          <thead><tr role="row">{columns.map((c) => <th key={c.label} role="columnheader" scope="col">{c.label}</th>)}<th role="columnheader" scope="col">Actions</th></tr></thead>
          <tbody>
            {rows === null && <SkeletonRows cols={nCols} />}
            {rows?.length === 0 && <tr role="row" className="empty-row"><td role="cell" colSpan={nCols}><EmptyState title="Aucun élément">{canWrite ? 'Utilisez « Ajouter » pour commencer.' : 'Rien à afficher pour le moment.'}</EmptyState></td></tr>}
            {rows?.map((r) => (
              <tr key={r.id} role="row">
                {columns.map((c) => <td key={c.label} role="cell" data-label={c.label}>{cell(r, c)}</td>)}
                <td role="cell" className="actions-cell" data-label="Actions"><div className="row">
                  {rowActions?.(r, load, { setInfo, setError })}
                  {canWrite && (canEditRow ? canEditRow(r) : true) && <button type="button" className="btn sec sm" onClick={() => open(r)}><Icon name="pencil" size={14} />Modifier</button>}
                  {canWrite && (canDeleteRow ? canDeleteRow(r) : true) && <button type="button" className="btn danger sm" onClick={() => remove(r)}><Icon name="trash" size={14} />Supprimer</button>}
                </div></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.row ? `Modifier – ${title}` : `Ajouter – ${title}`} onClose={() => setModal(null)} wide={wideModal}>
          <form onSubmit={save}>
            <div className="form-grid">
              {fields.map((f0) => {
                const f = f0.requiredOnCreate ? { ...f0, required: !modal.row } : f0;
                return <Field key={f.name} f={f} value={form[f.name]} options={f.options || opts[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))}
                  form={form} patch={(p) => setForm((s) => ({ ...s, ...p }))} editing={modal.row} reloadOptions={() => loadOpts(f.name)} />;
              })}
            </div>
            <Alert>{formError}</Alert>
            <div className="modal-actions"><button className="btn" disabled={saving}>{saving ? <><span className="spinner" aria-hidden="true" />Enregistrement…</> : 'Enregistrer'}</button><button type="button" className="btn sec" onClick={() => setModal(null)}>Annuler</button></div>
          </form>
        </Modal>)}
    </div>
  );
}

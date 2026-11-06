import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, money } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import { Alert, Pill } from '../components/ui.jsx';
import { ANNEE, LIBELLE } from '../rules.js';
import { fmtDate } from '../api.js';

const NIVEAUX = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année'];
const AUGMENTATION = 50;
const prevAnnee = (a) => { const y = Number(String(a).slice(0, 4)); return `${y - 1}-${y}`; };
const MOTIFS = { creation: 'Création', modification: 'Modification', augmentation_auto: `Augmentation automatique (+${AUGMENTATION} DT)`, suppression: 'Suppression' };

// Un prix par niveau et par année ; l'année suivante reprend le prix + 50 DT automatiquement ; tout changement est historisé.
function GrilleNiveaux({ version, onChanged }) {
  const { config } = useAuth();
  const [annee, setAnnee] = useState(config.anneeCourante || '');
  const [rows, setRows] = useState(null); const [prev, setPrev] = useState([]);
  const [edit, setEdit] = useState(null); // {niveau, montant}
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(null);
  const valide = /^\d{4}-\d{4}$/.test(annee);

  const load = useCallback(async () => {
    if (!valide) return;
    try {
      const [cur, old] = await Promise.all([api(`/tarifs?annee=${annee}&type=scolarite`), api(`/tarifs?annee=${prevAnnee(annee)}&type=scolarite`)]);
      setRows(cur); setPrev(old); setErr('');
    } catch (e) { setErr(e.message); setRows([]); }
  }, [annee, valide]);
  useEffect(() => { load(); }, [load, version]);

  const save = async () => {
    const montant = Number(edit.montant); const t = rows.find((r) => r.niveau === edit.niveau);
    if (!(montant > 0)) { setErr('Saisissez un montant supérieur à 0.'); return; }
    setBusy(true); setErr('');
    try {
      if (t) await api(`/tarifs/${t.id}`, { method: 'PUT', body: { montant } });
      else await api('/tarifs', { method: 'POST', body: { libelle: `Scolarité – ${edit.niveau}`, type: 'scolarite', niveau: edit.niveau, montant, annee_scolaire: annee } });
      setEdit(null); setOk(`Tarif « ${edit.niveau} » enregistré (l'ancien prix reste dans l'historique).`); await load(); onChanged(); if (hist) loadHist();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const generer = async () => {
    setBusy(true); setErr(''); setOk('');
    try { const r = await api('/tarifs/generer', { method: 'POST', body: { annee } }); setOk(r.crees ? `${r.crees} tarif(s) créé(s) pour ${annee} (+${AUGMENTATION} DT par niveau).` : 'Tous les niveaux ont déjà un tarif pour cette année.'); await load(); onChanged(); if (hist) loadHist(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const loadHist = async () => { try { setHist(await api('/tarifs/historique')); } catch (e) { setErr(e.message); } };

  return (
    <section className="card" aria-labelledby="grille-t">
      <div className="row between wrap">
        <h2 id="grille-t">Scolarité par niveau</h2>
        <div className="row">
          <label htmlFor="g-annee" className="sr-only">Année scolaire</label>
          <input id="g-annee" className="year-input" value={annee} maxLength={9} pattern="\d{4}-\d{4}" placeholder="2026-2027" onChange={(e) => setAnnee(e.target.value.trim())} />
          <button type="button" className="btn sec sm" disabled={busy || !valide} onClick={generer}>Générer les tarifs de l'année</button>
        </div>
      </div>
      <p className="muted small">Chaque niveau a son propre prix. À chaque nouvelle année scolaire, le tarif de l'année précédente est repris avec <strong>+{AUGMENTATION} DT</strong> automatiquement. Les tarifs des années passées ne sont jamais modifiés.</p>
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
      <div className="table-wrap stack">
        <table>
          <thead><tr><th scope="col">Niveau</th><th scope="col">{prevAnnee(annee)}</th><th scope="col">{annee}</th><th scope="col">Évolution</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {NIVEAUX.map((n) => {
              const cur = rows?.find((r) => r.niveau === n); const old = prev.find((r) => r.niveau === n);
              const diff = cur && old ? Number(cur.montant) - Number(old.montant) : null;
              const editing = edit?.niveau === n;
              return (
                <tr key={n}>
                  <td data-label="Niveau"><strong>{n}</strong></td>
                  <td data-label={prevAnnee(annee)}>{old ? money(old.montant) : '—'}</td>
                  <td data-label={annee}>{editing
                    ? <><label className="sr-only" htmlFor={`m-${n}`}>Montant {n}</label><input id={`m-${n}`} className="amount-input" type="number" min="0.01" max="100000" step="0.01" autoFocus value={edit.montant} onChange={(e) => setEdit({ ...edit, montant: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} /></>
                    : cur ? <strong>{money(cur.montant)}</strong> : <span className="muted">Non défini</span>}</td>
                  <td data-label="Évolution">{diff === null ? '—' : <Pill kind={diff > 0 ? 'warn' : diff < 0 ? 'ok' : ''}>{diff > 0 ? '+' : ''}{diff.toFixed(2)} DT</Pill>}</td>
                  <td data-label="Actions" className="actions-cell"><div className="row">
                    {editing
                      ? <><button type="button" className="btn sm" disabled={busy} onClick={save}>Enregistrer</button><button type="button" className="btn sec sm" onClick={() => setEdit(null)}>Annuler</button></>
                      : <button type="button" className="btn sec sm" disabled={!valide} onClick={() => setEdit({ niveau: n, montant: cur ? cur.montant : old ? Number(old.montant) + AUGMENTATION : '' })}>{cur ? 'Modifier' : 'Définir'}</button>}
                  </div></td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: '.75rem' }}>
        <button type="button" className="btn sec sm" aria-expanded={!!hist} onClick={() => (hist ? setHist(null) : loadHist())}>{hist ? "Masquer l'historique" : "Voir l'historique des tarifs"}</button>
      </div>
      {hist && (
        <div className="table-wrap stack" style={{ marginTop: '.75rem' }}>
          <table>
            <caption className="sr-only">Historique des tarifs</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Niveau</th><th scope="col">Année</th><th scope="col">Ancien</th><th scope="col">Nouveau</th><th scope="col">Motif</th><th scope="col">Par</th></tr></thead>
            <tbody>
              {hist.length === 0 && <tr><td colSpan={7} className="muted">Aucun historique.</td></tr>}
              {hist.map((h) => (
                <tr key={h.id}>
                  <td data-label="Date">{fmtDateTime(h.created_at)}</td><td data-label="Niveau">{h.niveau || '—'}</td><td data-label="Année">{h.annee_scolaire}</td>
                  <td data-label="Ancien">{h.montant_ancien === null ? '—' : money(h.montant_ancien)}</td><td data-label="Nouveau">{h.montant_nouveau === null ? '—' : money(h.montant_nouveau)}</td>
                  <td data-label="Motif">{MOTIFS[h.motif] || h.motif}</td><td data-label="Par">{h.utilisateur || 'Système'}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </section>
  );
}

export default function Tarifs() {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <CrudPage title="Grille tarifaire" endpoint="/tarifs" annee onChange={bump} above={<GrilleNiveaux version={version} onChanged={bump} />}
      hint="Les autres frais (inscription, tranches, divers) se gèrent dans le tableau ci-dessous."
      columns={[{ key: 'libelle', label: 'Libellé' }, { key: 'type', label: 'Type' }, { key: 'niveau', label: 'Niveau' }, { label: 'Montant', render: (r) => money(r.montant) }, { label: 'Échéance', render: (r) => fmtDate(r.echeance) }]}
      fields={[{ name: 'libelle', label: 'Libellé', required: true, ...LIBELLE(100) }, { name: 'type', label: 'Type', type: 'select', required: true, options: ['inscription', 'scolarite', 'tranche', 'autre'].map((v) => ({ value: v, label: v })) },
        { name: 'niveau', label: 'Niveau (obligatoire pour la scolarité)', type: 'select', options: NIVEAUX.map((v) => ({ value: v, label: v })) }, { name: 'montant', label: 'Montant (TND)', type: 'number', step: '0.01', min: 0.01, max: 100000, required: true },
        { name: 'echeance', label: 'Échéance', type: 'date', help: "Doit être dans l'année scolaire (1er sept. → 31 août)." }, { name: 'annee_scolaire', label: 'Année scolaire', ...ANNEE }]}
      validate={(f) => (f.type === 'scolarite' && !f.niveau ? 'La scolarité doit être rattachée à un niveau : chaque niveau a son propre prix.' : null)}
      defaults={{ type: 'scolarite' }} />
  );
}

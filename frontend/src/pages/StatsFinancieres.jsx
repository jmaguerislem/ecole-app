import { useEffect, useState } from 'react';
import { api, fmtDate, money } from '../api.js';
import { Bars, Columns, Donut } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Modal, PageHeader, Pill, Spinner } from '../components/ui.jsx';
import { useLive } from '../useLive.js';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MODES = { especes: 'Espèces', virement: 'Virement', cheque: 'Chèque', mobile_money: 'Mobile money' };
const STATUT = { paye: ['Payé', 'ok'], en_attente: ['À venir', 'warn'], en_retard: ['En retard', 'bad'] };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
const nom = (e) => e.replace(/^École Primaire /, '');
const PALETTE = ['#2563EB', '#E11D48', '#059669', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];

function Kpi({ value, label, icon, tone = 'brand', sub }) {
  return <div className="stat stat-link" style={{ cursor: 'default' }}><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{value}</b><span className="stat-label">{label}</span>{sub && <span className="stat-label small">{sub}</span>}</span></div>;
}

// Statistiques financières du propriétaire : loyers des écoles louées. Chiffres = GET /api/saas/finance/stats (tables loyer_echeances / loyer_encaissements).
// Règle : seuls les encaissements enregistrés sont des revenus ; une échéance non réglée n'est jamais comptée comme payée.
export default function StatsFinancieres() {
  const [ecole, setEcole] = useState(''); const [annee, setAnnee] = useState(String(new Date().getFullYear())); const [mois, setMois] = useState('');
  const qs = (m) => `?annee=${annee}${ecole ? `&ecole_id=${ecole}` : ''}${m ? `&mois=${m}` : ''}`;
  const an = useLive(`/saas/finance/stats${qs('')}`);              // toute l'année : graphique mensuel, totaux annuels
  const pe = useLive(mois ? `/saas/finance/stats${qs(mois)}` : null); // mois choisi : totaux de ce mois seulement
  const [pay, setPay] = useState(null); const [contrat, setContrat] = useState(null); const [msg, setMsg] = useState(null);
  const d = an.data; const p = mois ? pe.data : an.data;
  if (an.err && !d) return <Alert>{an.err}</Alert>;
  if (!d || !p) return <Spinner />;

  const T = p.totaux; const periode = mois ? `${MOIS[mois - 1]} ${annee}` : `année ${annee}`;
  const taux = (t) => { const du = t.encaisse + t.impaye; return du > 0 ? `${Math.round((t.encaisse / du) * 1000) / 10} %` : '—'; };
  const mensuel = d.mensuel.map((m) => ({ label: m.nom, prevu: m.prevu, encaisse: m.encaisse, active: !mois || m.mois === Number(mois) }));
  const couleurs = (list) => list.map((e, i) => ({ ...e, color: PALETTE[i % PALETTE.length] }));
  const parEcole = couleurs(p.par_ecole);
  const sansContrat = d.ecoles.filter((e) => !d.par_ecole.some((x) => x.school_id === e.id));
  const reload = () => { an.reload(); pe.reload(); };

  return (
    <div>
      <PageHeader title="Statistiques financières" subtitle="Loyers des écoles que vous louez : payés, impayés, par mois et par année. Seules les données enregistrées en base sont utilisées.">
        <span className="live" role="status"><span className="live-dot" aria-hidden="true" />{an.maj ? `Mis à jour à ${an.maj.toLocaleTimeString('fr-FR')}` : 'Chargement…'}</span>
        <button type="button" className="btn sec sm" onClick={reload}>Actualiser</button>
      </PageHeader>
      <Alert>{an.err || pe.err}</Alert>{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="filters" role="group" aria-label="Filtres">
        <div><label htmlFor="f-ecole">École</label>
          <select id="f-ecole" value={ecole} onChange={(e) => setEcole(e.target.value)}><option value="">Toutes les écoles ({d.ecoles.length})</option>{d.ecoles.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></div>
        <div><label htmlFor="f-annee">Année</label>
          <select id="f-annee" value={annee} onChange={(e) => setAnnee(e.target.value)}>{d.annees.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        <div><label htmlFor="f-mois">Période</label>
          <select id="f-mois" value={mois} onChange={(e) => setMois(e.target.value)}><option value="">Toute l'année</option>{MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
      </div>

      <h2 className="section-title">Synthèse – {periode}{ecole ? ` · ${d.ecoles.find((e) => String(e.id) === ecole)?.label}` : ''}</h2>
      <div className="grid">
        <Kpi value={money(T.encaisse)} label="Loyers payés (encaissés)" icon="banknote" tone="ok" sub={`${T.nb_payees} échéance(s) soldée(s)`} />
        <Kpi value={money(T.impaye)} label="Loyers impayés (en retard)" icon="alert-triangle" tone={T.impaye > 0 ? 'bad' : 'brand'} sub={`${T.nb_en_retard} échéance(s) en retard`} />
        <Kpi value={money(T.en_attente)} label="À venir (non échus)" icon="clock" tone="warn" sub={`${T.nb_en_attente} échéance(s)`} />
        <Kpi value={taux(T)} label="Taux de recouvrement" icon="check-circle" sub={`Loyer mensuel total : ${money(T.loyer_mensuel_total)}`} />
      </div>
      {mois && <p className="muted small" style={{ marginTop: '.6rem' }}>Totaux annuels {annee} : encaissé {money(d.totaux.encaisse)} · impayé {money(d.totaux.impaye)} · prévu {money(d.totaux.prevu)}.</p>}

      <h2 className="section-title">Graphiques</h2>
      <div className="grid charts">
        <div className="card wide2"><Columns title={`Loyers par mois – ${annee}`} unit=" TND" data={mensuel} series={[{ key: 'prevu', label: 'Loyer prévu', color: '#94A3B8' }, { key: 'encaisse', label: 'Loyer encaissé', color: '#16A34A' }]} /></div>
        <div className="card"><Donut title={`Échéances – ${periode}`} center={String(T.nb_payees + T.nb_en_attente + T.nb_en_retard)} data={[{ label: 'Payées', color: '#16A34A', value: T.nb_payees }, { label: 'À venir', color: '#F59E0B', value: T.nb_en_attente }, { label: 'En retard', color: '#DC2626', value: T.nb_en_retard }]} /></div>
        <div className="card"><Bars title="Loyers encaissés par école (TND)" data={parEcole.map((e) => ({ key: e.school_id, label: nom(e.ecole), value: e.encaisse, color: e.color }))} /></div>
        <div className="card"><Bars title="Loyers impayés par école (TND)" data={parEcole.map((e) => ({ key: e.school_id, label: nom(e.ecole), value: e.impaye, color: '#DC2626' }))} /></div>
      </div>

      <h2 className="section-title">Écoles et contrats de location</h2>
      <div className="table-wrap stack"><table>
        <thead><tr><th>École</th><th>Loyer mensuel</th><th>Prévu</th><th>Payé</th><th>Impayé</th><th>À venir</th><th>Recouvrement</th><th /></tr></thead>
        <tbody>
          {p.par_ecole.length === 0 && sansContrat.length === 0 && <tr><td colSpan="8" className="empty">Aucun contrat de location enregistré.</td></tr>}
          {p.par_ecole.map((e) => (
            <tr key={e.school_id}>
              <td data-label="École"><b>{e.ecole}</b><div className="muted small">{e.echeances_payees} payée(s) · {e.echeances_en_retard} en retard</div></td>
              <td data-label="Loyer mensuel">{money(e.loyer_mensuel)}</td><td data-label="Prévu">{money(e.prevu)}</td><td data-label="Payé">{money(e.encaisse)}</td>
              <td data-label="Impayé">{e.impaye > 0 ? <Pill kind="bad">{money(e.impaye)}</Pill> : money(0)}</td><td data-label="À venir">{money(e.a_venir)}</td>
              <td data-label="Recouvrement">{e.taux_recouvrement == null ? '—' : `${e.taux_recouvrement} %`}</td>
              <td><div className="row"><button type="button" className="btn sec sm" onClick={() => setEcole(String(e.school_id))}>Détail</button><button type="button" className="btn sec sm" onClick={() => setContrat({ school_id: e.school_id, label: e.ecole, ...e, ouvert: true })}>Contrat</button></div></td>
            </tr>))}
          {!ecole && sansContrat.map((e) => (
            <tr key={`s${e.id}`}><td data-label="École"><b>{e.label}</b></td><td colSpan="6" className="muted" data-label="Contrat">Aucun contrat de location enregistré</td>
              <td><button type="button" className="btn sm" onClick={() => setContrat({ school_id: e.id, label: e.label, nouveau: true })}>Définir le contrat</button></td></tr>))}
        </tbody>
      </table></div>

      {ecole && d.echeances && <>
        <h2 className="section-title">Échéances – {d.ecoles.find((e) => String(e.id) === ecole)?.label}</h2>
        <div className="table-wrap stack"><table>
          <thead><tr><th>Période</th><th>Échéance</th><th>Montant dû</th><th>Payé</th><th>Reste</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {d.echeances.length === 0 && <tr><td colSpan="7" className="empty">Aucune échéance pour {annee}.</td></tr>}
            {d.echeances.map((e) => (
              <tr key={e.id}><td data-label="Période">{MOIS[Number(e.periode.slice(5, 7)) - 1]} {e.periode.slice(0, 4)}</td><td data-label="Échéance">{fmtDate(e.echeance)}</td><td data-label="Montant dû">{money(e.montant_du)}</td><td data-label="Payé">{money(e.paye)}</td><td data-label="Reste">{money(e.reste)}</td>
                <td data-label="Statut"><Pill kind={STATUT[e.statut][1]}>{STATUT[e.statut][0]}{e.partiel ? ' (partiel)' : ''}</Pill></td>
                <td>{e.reste > 0 && <button type="button" className="btn sm" onClick={() => setPay({ id: e.id, ecole: d.ecoles.find((x) => String(x.id) === ecole)?.label, periode: e.periode, reste: e.reste })}>Enregistrer un paiement</button>}</td></tr>))}
          </tbody>
        </table></div>
      </>}

      <h2 className="section-title">Loyers en retard</h2>
      <div className="table-wrap stack"><table>
        <thead><tr><th>École</th><th>Période</th><th>Échéance</th><th>Retard</th><th>Reste dû</th><th /></tr></thead>
        <tbody>
          {p.retards.length === 0 && <tr><td colSpan="6" className="empty">Aucun loyer en retard.</td></tr>}
          {p.retards.map((r) => (
            <tr key={r.echeance_id}><td data-label="École"><b>{r.ecole}</b></td><td data-label="Période">{MOIS[Number(r.periode.slice(5, 7)) - 1]} {r.periode.slice(0, 4)}</td><td data-label="Échéance">{fmtDate(r.echeance)}</td>
              <td data-label="Retard"><Pill kind="bad">{r.jours_retard} jour(s)</Pill></td><td data-label="Reste dû">{money(r.reste)}</td>
              <td><button type="button" className="btn sm" onClick={() => setPay({ id: r.echeance_id, ecole: r.ecole, periode: r.periode, reste: r.reste })}>Enregistrer un paiement</button></td></tr>))}
        </tbody>
      </table></div>

      <h2 className="section-title">Derniers loyers encaissés</h2>
      <div className="table-wrap stack"><table>
        <thead><tr><th>Date</th><th>École</th><th>Période</th><th>Montant</th><th>Mode</th><th>Référence</th></tr></thead>
        <tbody>
          {p.historique.length === 0 && <tr><td colSpan="6" className="empty">Aucun encaissement sur la période.</td></tr>}
          {p.historique.map((h) => (
            <tr key={h.id}><td data-label="Date">{fmtDate(h.date_paiement)}</td><td data-label="École">{h.ecole}</td><td data-label="Période">{MOIS[Number(h.periode.slice(5, 7)) - 1]} {h.periode.slice(0, 4)}</td><td data-label="Montant"><b>{money(h.montant)}</b></td><td data-label="Mode">{MODES[h.mode] || h.mode}</td><td data-label="Référence">{h.reference || '—'}</td></tr>))}
        </tbody>
      </table></div>

      {pay && <PaiementModal pay={pay} onClose={() => setPay(null)} onDone={(t) => { setPay(null); setMsg({ kind: 'ok', text: t }); reload(); }} />}
      {contrat && <ContratModal c={contrat} onClose={() => setContrat(null)} onDone={(t) => { setContrat(null); setMsg({ kind: 'ok', text: t }); reload(); }} />}
    </div>
  );
}

function PaiementModal({ pay, onClose, onDone }) {
  const [f, setF] = useState({ montant: String(pay.reste), date_paiement: today(), mode: 'especes', reference: '', notes: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api(`/saas/echeances/${pay.id}/encaissements`, { method: 'POST', body: { montant: Number(f.montant), date_paiement: f.date_paiement, mode: f.mode, reference: f.reference || undefined, notes: f.notes || undefined } });
      onDone(`Paiement de ${money(r.montant)} enregistré pour ${pay.ecole}${r.reste_apres > 0 ? ` (reste ${money(r.reste_apres)})` : ' : échéance soldée'}.`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Paiement – ${pay.ecole}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">Loyer de {MOIS[Number(pay.periode.slice(5, 7)) - 1]} {pay.periode.slice(0, 4)} · reste à payer : <b>{money(pay.reste)}</b></p>
        <div className="form-grid">
          <div><label htmlFor="p-m">Montant (TND) *</label><input id="p-m" type="number" required min="0.01" max={pay.reste} step="0.01" value={f.montant} onChange={set('montant')} /></div>
          <div><label htmlFor="p-d">Date du paiement *</label><input id="p-d" type="date" required max={today()} value={f.date_paiement} onChange={set('date_paiement')} /></div>
          <div><label htmlFor="p-mode">Mode *</label><select id="p-mode" value={f.mode} onChange={set('mode')}>{Object.entries(MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label htmlFor="p-ref">Référence{f.mode !== 'especes' ? ' *' : ''}</label><input id="p-ref" maxLength={60} required={f.mode !== 'especes'} value={f.reference} onChange={set('reference')} placeholder="N° de virement, de chèque…" /></div>
          <div className="full"><label htmlFor="p-n">Notes</label><input id="p-n" maxLength={500} value={f.notes} onChange={set('notes')} /></div>
        </div>
        <Alert>{err}</Alert>
        <div className="modal-actions"><button className="btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le paiement'}</button><button type="button" className="btn sec" onClick={onClose}>Annuler</button></div>
      </form>
    </Modal>);
}

function ContratModal({ c, onClose, onDone }) {
  const [f, setF] = useState({ loyer_mensuel: c.nouveau ? '' : String(c.loyer_mensuel), jour_echeance: '5', date_debut: `${new Date().getFullYear()}-01-01`, date_fin: '', caution: '', notes: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [charge, setCharge] = useState(!c.nouveau);
  // Contrat existant : on relit tous ses champs (jour d'échéance, dates, caution…) avant de les proposer à la modification
  useEffect(() => {
    if (c.nouveau) return;
    api(`/saas/schools/${c.school_id}`).then((r) => { const k = r.contrat; if (k) setF({ loyer_mensuel: String(k.loyer_mensuel), jour_echeance: String(k.jour_echeance), date_debut: String(k.date_debut).slice(0, 10), date_fin: k.date_fin ? String(k.date_fin).slice(0, 10) : '', caution: k.caution == null ? '' : String(k.caution), notes: k.notes || '' }); })
      .catch((x) => setErr(x.message)).finally(() => setCharge(false));
  }, [c.nouveau, c.school_id]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api(`/saas/schools/${c.school_id}/contrat`, { method: 'PUT', body: { loyer_mensuel: Number(f.loyer_mensuel), jour_echeance: Number(f.jour_echeance), date_debut: f.date_debut, date_fin: f.date_fin || null, caution: f.caution === '' ? null : Number(f.caution), notes: f.notes || null } });
      onDone(`Contrat de location de ${c.label} enregistré : les échéances mensuelles ont été générées.`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Contrat de location – ${c.label}`} onClose={onClose}>
      {charge ? <Spinner /> : <form onSubmit={submit}>
        <div className="form-grid">
          <div><label htmlFor="c-l">Loyer mensuel (TND) *</label><input id="c-l" type="number" required min="0" step="0.01" value={f.loyer_mensuel} onChange={set('loyer_mensuel')} /></div>
          <div><label htmlFor="c-j">Jour d'échéance (1 à 28) *</label><input id="c-j" type="number" required min="1" max="28" step="1" value={f.jour_echeance} onChange={set('jour_echeance')} /></div>
          <div><label htmlFor="c-d">Début du contrat *</label><input id="c-d" type="date" required value={f.date_debut} onChange={set('date_debut')} /></div>
          <div><label htmlFor="c-f">Fin du contrat</label><input id="c-f" type="date" min={f.date_debut} value={f.date_fin} onChange={set('date_fin')} /></div>
          <div><label htmlFor="c-c">Caution (TND)</label><input id="c-c" type="number" min="0" step="0.01" value={f.caution} onChange={set('caution')} /></div>
          <div className="full"><label htmlFor="c-n">Notes</label><input id="c-n" maxLength={1000} value={f.notes} onChange={set('notes')} /></div>
        </div>
        <p className="muted small">Les échéances déjà réglées ne sont jamais modifiées : un nouveau loyer s'applique aux échéances sans paiement à partir du mois courant.</p>
        <Alert>{err}</Alert>
        <div className="modal-actions"><button className="btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le contrat'}</button><button type="button" className="btn sec" onClick={onClose}>Annuler</button></div>
      </form>}
    </Modal>);
}

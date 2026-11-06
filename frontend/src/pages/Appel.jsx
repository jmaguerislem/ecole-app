import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Avatar, PageHeader, Pill, Spinner } from '../components/ui.jsx';

const MOTIF_MAX = 200;
const RETRO_JOURS_ENSEIGNANT = 30;
const PERIODES = [{ value: 'journee', label: 'Journée' }, { value: 'matin', label: 'Matin' }, { value: 'apres_midi', label: 'Après-midi' }];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addJours = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export default function Appel() {
  const { user, config } = useAuth();
  const admin = false; // page réservée aux enseignants
  const today = iso(new Date());
  const debutAnnee = `${String(config.anneeCourante || '').slice(0, 4) || new Date().getFullYear()}-09-01`;
  const minDate = admin ? debutAnnee : iso(addJours(new Date(), -RETRO_JOURS_ENSEIGNANT));
  const [classes, setClasses] = useState(null);
  const [classeId, setClasseId] = useState('');
  const [date, setDate] = useState(() => { const d = new Date(); return iso(d.getDay() === 0 ? addJours(d, -1) : d); });
  const [eleves, setEleves] = useState([]);
  const [etat, setEtat] = useState({});
  const [initial, setInitial] = useState('{}');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');

  // Contrôle de la date saisie (le champ date peut être tapé à la main)
  const dateErr = useMemo(() => {
    if (!date) return 'Choisissez une date.';
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return 'Date invalide.';
    if (date > today) return 'La date ne peut pas être dans le futur.';
    if (d.getDay() === 0) return "L'école est fermée le dimanche.";
    if (date < minDate) return admin ? `La date doit appartenir à l'année scolaire ${config.anneeCourante}.` : `Vous ne pouvez pas saisir une absence de plus de ${RETRO_JOURS_ENSEIGNANT} jours (contactez l'administration).`;
    return '';
  }, [date, today, minDate, admin, config.anneeCourante]);

  const dirty = JSON.stringify(etat) !== initial;
  const confirmLeave = () => !dirty || window.confirm('Des modifications non enregistrées seront perdues. Continuer ?');

  useEffect(() => {
    api('/absences/appel/classes').then((c) => { setClasses(c); if (c.length === 1) setClasseId(String(c[0].id)); }).catch((e) => { setClasses([]); setErr(e.message); });
  }, []);

  const load = () => {
    if (!classeId || dateErr) { setEleves([]); setEtat({}); setInitial('{}'); return; }
    setLoading(true); setErr('');
    api(`/absences/appel?classe_id=${classeId}&date=${date}`).then((d) => {
      const e = Object.fromEntries(d.eleves.map((x) => [x.eleve_id, {
        absent: !!x.absence_id, periode: x.periode || 'journee', motif: x.motif || '',
        verrou: !!x.justifiee && !admin, justifiee: !!x.justifiee,
      }]));
      setEleves(d.eleves); setEtat(e); setInitial(JSON.stringify(e));
    }).catch((e) => { setErr(e.message); setEleves([]); setEtat({}); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [classeId, date, dateErr]);

  const set = (id, patch) => setEtat((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const toggle = (id) => { setOk(''); if (!etat[id].verrou) set(id, { absent: !etat[id].absent }); };
  const tousPresents = () => { setOk(''); setEtat((s) => Object.fromEntries(Object.entries(s).map(([id, v]) => [id, v.verrou ? v : { ...v, absent: false, motif: '' }]))); };

  const nbAbsents = Object.values(etat).filter((v) => v.absent).length;
  const save = async () => {
    setErr(''); setOk('');
    const absents = Object.entries(etat).filter(([, v]) => v.absent).map(([id, v]) => ({ eleve_id: Number(id), periode: v.periode, motif: v.motif.trim() }));
    setSaving(true);
    try {
      const r = await api('/absences/appel', { method: 'PUT', body: { classe_id: Number(classeId), date_absence: date, absents } });
      setOk(`Appel du ${fmtDate(date)} enregistré : ${r.absents} absent(s)${r.conserves ? ` (${r.conserves} absence(s) justifiée(s) conservée(s))` : ''}.`);
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  if (classes === null) return <Spinner />;
  return (
    <div>
      <PageHeader title="Faire l'appel" subtitle="Choisissez la classe et la date, puis touchez chaque élève absent. Les élèves non cochés sont considérés présents." />
      <div className="card appel-bar">
        <div style={{ minWidth: 220, flex: 1 }}>
          <label htmlFor="appel-classe">Classe</label>
          <select id="appel-classe" value={classeId} onChange={(e) => { if (confirmLeave()) setClasseId(e.target.value); }}>
            <option value="">— Choisir une classe —</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.effectif} élèves)</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <label htmlFor="appel-date">Date</label>
          <input id="appel-date" type="date" value={date} min={minDate} max={today} onChange={(e) => { if (confirmLeave()) setDate(e.target.value); }} aria-invalid={!!dateErr} />
        </div>
      </div>
      {classes.length === 0 && !err && <Alert kind="warn">Aucune classe ne vous est affectée pour l'année {config.anneeCourante}. Contactez l'administration.</Alert>}
      <Alert>{err}</Alert>{classeId && <Alert kind="warn">{dateErr}</Alert>}<Alert kind="ok">{ok}</Alert>

      {classeId && !dateErr && (
        <>
          <div className="row between" style={{ margin: '.5rem 0 .75rem' }}>
            <div className="counter" aria-live="polite"><span><strong>{eleves.length - nbAbsents}</strong> présent(s)</span><span><strong>{nbAbsents}</strong> absent(s)</span><span className="muted">sur {eleves.length}</span></div>
            <button type="button" className="btn sec sm" onClick={tousPresents} disabled={loading || !nbAbsents}><Icon name="check" size={14} />Tous présents</button>
          </div>
          {loading ? <Spinner label="Chargement des élèves…" /> : (
            <ul className="appel-list">
              {eleves.map((e) => {
                const v = etat[e.eleve_id]; if (!v) return null;
                return (
                  <li key={e.eleve_id} className={`appel-row${v.absent ? ' absent' : ''}`}>
                    <button type="button" className="appel-toggle" aria-pressed={v.absent} disabled={v.verrou} onClick={() => toggle(e.eleve_id)}
                      aria-label={`${e.nom} ${e.prenom} : ${v.absent ? 'absent' : 'présent'}. Cliquer pour changer.`}>
                      <Avatar prenom={e.prenom} nom={e.nom} size={40} />
                      <span className="appel-name">{e.nom} {e.prenom}</span>
                      <span className="appel-state">{v.justifiee && <Pill kind="ok">Justifiée</Pill>}<Pill kind={v.absent ? 'bad' : 'ok'}>{v.absent ? 'Absent' : 'Présent'}</Pill></span>
                    </button>
                    {v.absent && (
                      <div className="appel-detail">
                        <select aria-label={`Période d'absence de ${e.prenom} ${e.nom}`} value={v.periode} disabled={v.verrou} onChange={(x) => set(e.eleve_id, { periode: x.target.value })} style={{ maxWidth: 170 }}>
                          {PERIODES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                        <input aria-label={`Motif de l'absence de ${e.prenom} ${e.nom} (facultatif)`} placeholder="Motif (facultatif)" maxLength={MOTIF_MAX} value={v.motif} disabled={v.verrou} onChange={(x) => set(e.eleve_id, { motif: x.target.value })} />
                      </div>
                    )}
                  </li>
                );
              })}
              {eleves.length === 0 && <li className="card empty">Aucun élève actif dans cette classe.</li>}
            </ul>
          )}
          <div className="sticky-bar">
            <span className="muted small">{!dirty && !loading && eleves.length > 0 ? 'Aucune modification à enregistrer.' : dirty ? 'Modifications non enregistrées.' : ''}</span>
            <button type="button" className="btn" onClick={save} disabled={saving || loading || !dirty || eleves.length === 0}>{saving ? <><span className="spinner" aria-hidden="true" />Enregistrement…</> : <><Icon name="check" size={16} />Enregistrer l'appel</>}</button>
          </div>
        </>
      )}
    </div>
  );
}

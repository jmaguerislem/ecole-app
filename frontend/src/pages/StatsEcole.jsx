import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, money } from '../api.js';
import { Bars, Donut } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, PageHeader, Pill, Spinner } from '../components/ui.jsx';

// Page du DIRECTEUR : statistiques de SA seule école (route GET /api/stats/mon-ecole).
// Le serveur ne renvoie que les données de l'école du compte connecté ; rien n'est lu dans l'adresse de la page.
// Les chiffres sont calculés en base à chaque appel et actualisés automatiquement (modification, 15 s, retour sur l'onglet).
const STATUT = { active: ['Active', 'ok'], suspended: ['Suspendue', 'bad'], trial: ['En essai', 'warn'] };
const MODES = { especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile money' };
const REFRESH_MS = 15000;
const fmt = (v) => Number(v || 0).toLocaleString('fr-FR');
const nd = (v, suffix = '') => (v === null || v === undefined ? '—' : `${fmt(v)}${suffix}`);
const moisLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

function Kpi({ n, label, icon, tone = 'brand', sub }) {
  return <div className="stat stat-link" style={{ cursor: 'default' }}><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{n}</b><span className="stat-label">{label}</span>{sub && <span className="stat-label small">{sub}</span>}</span></div>;
}
const Montant = ({ v }) => <>{Number(v || 0).toFixed(2)}<small className="unit"> TND</small></>;
function Fiche({ titre, lignes }) {
  return (
    <section className="card" aria-label={titre}>
      <h3 style={{ marginTop: 0 }}>{titre}</h3>
      <div>{lignes.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    </section>
  );
}

export default function StatsEcole() {
  const [s, setS] = useState(null); const [err, setErr] = useState('');
  const [maj, setMaj] = useState(null); const [live, setLive] = useState(false);
  const timer = useRef(); const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return; busy.current = true; setLive(true);
    try { setS(await api('/stats/mon-ecole')); setErr(''); setMaj(new Date()); } catch (e) { setErr(e.message); } finally { busy.current = false; setTimeout(() => setLive(false), 400); }
  }, []);
  useEffect(() => {
    load();
    const onChange = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); };
    const onVis = () => document.visibilityState === 'visible' && load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    window.addEventListener('data:changed', onChange); document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); clearTimeout(timer.current); window.removeEventListener('data:changed', onChange); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (err && !s) return <Alert>{err}</Alert>;
  if (!s) return <Spinner />;
  const { ecole: e, utilisateurs: U, eleves: E, classes: C, personnel: P, absences: A, presences: PR, paiements: PA, evaluations: EV, devoirs: D, communication: CO, preinscriptions: PI, abonnement: AB } = s;
  const [slabel, tone] = STATUT[e.status] || ['', ''];
  const quota = (x) => `${fmt(x.utilise)} / ${x.limite === null ? 'illimité' : fmt(x.limite)}`;

  return (
    <div>
      <PageHeader title="Statistiques de l'école" subtitle={`${e.label} · année scolaire ${s.annee} · calculées en direct à partir de la base de données.`}>
        <span className={`live${live ? ' on' : ''}`} role="status"><span className="live-dot" aria-hidden="true" />{maj ? `Mis à jour à ${maj.toLocaleTimeString('fr-FR')}` : 'Chargement…'}</span>
        <button type="button" className="btn sec sm" onClick={load}>Actualiser</button>
      </PageHeader>
      <Alert>{err}</Alert>

      <div className="grid">
        <Kpi n={fmt(E.actifs)} label="Élèves actifs" icon="graduation" sub={`${fmt(E.total)} au total · ${fmt(E.garcons)} garçons · ${fmt(E.filles)} filles`} />
        <Kpi n={fmt(U.enseignants)} label="Enseignants" icon="presentation" sub={`${fmt(P.enseignants_affectes)} avec une affectation`} />
        <Kpi n={fmt(U.parents)} label="Parents" icon="users" />
        <Kpi n={fmt(U.total)} label="Utilisateurs (tous comptes)" icon="key" sub={`${fmt(U.inactifs)} inactif${U.inactifs > 1 ? 's' : ''}`} />
        <Kpi n={fmt(C.annee)} label={`Classes ${s.annee}`} icon="school" sub={`${fmt(C.toutes_annees)} toutes années`} />
      </div>
      <div className="grid" style={{ marginTop: '1rem' }}>
        <Kpi n={nd(PR.presents_aujourdhui)} label="Présents aujourd'hui" icon="check-circle" tone="ok" sub={PR.ecole_fermee ? 'École fermée le dimanche' : `${nd(PR.taux_aujourdhui, ' %')} des ${fmt(PR.eleves_scolarises)} élèves scolarisés`} />
        <Kpi n={nd(PR.absents_aujourdhui)} label="Absents aujourd'hui" icon="user-x" tone={PR.absents_aujourdhui > 0 ? 'warn' : 'ok'} />
        <Kpi n={fmt(A.total)} label="Absences de l'année" icon="user-x" tone="warn" sub={`${fmt(A.justifiees)} justifiées · ${fmt(A.non_justifiees)} non justifiées`} />
        <Kpi n={<Montant v={PA.total_encaisse} />} label="Encaissé cette année" icon="banknote" tone="ok" sub={`${fmt(PA.nombre)} paiement${PA.nombre > 1 ? 's' : ''}`} />
        <Kpi n={fmt(PA.eleves_avec_impaye)} label={`Élèves avec impayé (${money(PA.total_impaye)})`} icon="alert-triangle" tone={PA.eleves_avec_impaye > 0 ? 'bad' : 'ok'} />
      </div>

      <h2 className="section-title">Graphiques</h2>
      <div className="grid charts">
        <div className="card"><Donut title="Utilisateurs par rôle" center={fmt(U.total)} data={[
          { label: 'Directeurs', color: '#1B2F5B', value: U.directeurs }, { label: 'Enseignants', color: '#0891B2', value: U.enseignants },
          { label: 'Parents', color: '#D97706', value: U.parents }, { label: 'Comptables', color: '#7C3AED', value: U.comptables }, { label: 'Comptes élèves', color: '#16A34A', value: U.comptes_eleves }]} /></div>
        <div className="card"><Donut title="Élèves par statut" data={[
          { label: 'Actifs', color: '#16A34A', value: E.actifs }, { label: 'Inactifs', color: '#F59E0B', value: E.inactifs }, { label: 'Diplômés', color: '#2563EB', value: E.diplomes }]} /></div>
        <div className="card"><Donut title="Absences : justifiées ou non" data={[
          { label: 'Justifiées', color: '#16A34A', value: A.justifiees }, { label: 'Non justifiées', color: '#DC2626', value: A.non_justifiees }]} /></div>
        <div className="card"><Donut title="Paiements par mode" center={fmt(PA.nombre)} data={PA.par_mode.map((x, i) => ({ label: MODES[x.mode] || x.mode, color: ['#2563EB', '#D97706', '#7C3AED'][i % 3], value: x.nombre }))} /></div>
        <div className="card wide2"><Bars title="Absences par mois" data={A.par_mois.map((m) => ({ key: m.mois, label: moisLabel(m.mois), value: m.total, color: '#D97706' }))} /></div>
        <div className="card wide2"><Bars title="Encaissements par mois (TND)" unit=" TND" data={PA.par_mois.map((m) => ({ key: m.mois, label: moisLabel(m.mois), value: Math.round(m.total), color: '#16A34A' }))} /></div>
        <div className="card wide2"><Bars title="Élèves actifs par classe" data={C.liste.map((c) => ({ key: c.id, label: c.nom, value: c.effectif, color: '#2563EB' }))} /></div>
      </div>

      <h2 className="section-title">Détail de l'école</h2>
      <div className="grid">
        <Fiche titre="Élèves" lignes={[
          ['Total (tous statuts)', fmt(E.total)], ['Actifs', fmt(E.actifs)], ['Inactifs', fmt(E.inactifs)], ['Diplômés', fmt(E.diplomes)],
          ['Garçons', fmt(E.garcons)], ['Filles', fmt(E.filles)], ['Sexe non renseigné', fmt(E.sexe_non_renseigne)], ['Actifs sans classe', fmt(E.actifs_sans_classe)]]} />
        <Fiche titre="Utilisateurs" lignes={[
          ['Directeurs', fmt(U.directeurs)], ['Enseignants', fmt(U.enseignants)], ['Parents', fmt(U.parents)], ['Comptables', fmt(U.comptables)],
          ['Comptes élèves', fmt(U.comptes_eleves)], ['Total', fmt(U.total)], ['Comptes actifs', fmt(U.actifs)], ['Comptes inactifs', fmt(U.inactifs)]]} />
        <Fiche titre="Organisation" lignes={[
          [`Classes ${s.annee}`, fmt(C.annee)], ['Capacité totale', fmt(C.capacite_totale)], ['Matières', fmt(P.matieres)], ['Salles', fmt(P.salles)],
          ['Affectations', fmt(P.affectations)], ['Créneaux d\'emploi du temps', fmt(P.creneaux)], ['Pré-inscriptions en attente', fmt(PI.en_attente)], ['Pré-inscriptions (total)', fmt(PI.total)]]} />
        <Fiche titre="Absences et présences" lignes={[
          ['Absences de l\'année', fmt(A.total)], ['Élèves concernés', fmt(A.eleves_concernes)], ['Absences ce mois', fmt(A.ce_mois)], ['Absences aujourd\'hui', fmt(A.aujourdhui)],
          ['Présents aujourd\'hui', nd(PR.presents_aujourdhui)], ['Absents aujourd\'hui', nd(PR.absents_aujourdhui)],
          [`Taux de présence du mois (${PR.jours_de_classe_ce_mois} j de classe)`, nd(PR.taux_mois, ' %')]]} />
        <Fiche titre="Paiements" lignes={[
          ['Encaissé cette année', money(PA.total_encaisse)], ['Encaissé ce mois', money(PA.encaisse_ce_mois)], ['Nombre de paiements', fmt(PA.nombre)], ['Élèves ayant payé', fmt(PA.eleves_payeurs)],
          ['Total dû (élèves actifs)', money(PA.total_du)], ['Reste à payer', money(PA.total_impaye)], ['Élèves avec impayé', fmt(PA.eleves_avec_impaye)], ['Taux de recouvrement', nd(PA.taux_recouvrement, ' %')]]} />
        <Fiche titre="Pédagogie et communication" lignes={[
          ['Évaluations', fmt(EV.evaluations)], ['Notes saisies', fmt(EV.notes)], ['Moyenne générale', EV.moyenne_sur_20 === null ? '—' : `${EV.moyenne_sur_20.toLocaleString('fr-FR')} / 20`],
          ['Devoirs', fmt(D.total)], ['Devoirs en cours', fmt(D.en_cours)], ['Devoirs rendus', fmt(D.depots)], ['Messages envoyés', fmt(CO.messages_envoyes)], ['Annonces', fmt(CO.annonces)]]} />
        <section className="card" aria-label="Abonnement">
          <h3 style={{ marginTop: 0 }}>Abonnement</h3>
          <div className="kv"><span>Statut</span><Pill kind={tone}>{slabel}</Pill></div>
          <div className="kv"><span>Formule</span><b>{AB.formule}</b></div>
          <div className="kv"><span>Fin d'abonnement</span><b>{AB.fin ? fmtDate(AB.fin) : '—'}</b></div>
          <div className="kv"><span>Élèves (quota)</span><b>{quota(AB.quota_eleves)}</b></div>
          <div className="kv"><span>Utilisateurs (quota)</span><b>{quota(AB.quota_utilisateurs)}</b></div>
        </section>
      </div>

      <h2 className="section-title">Classes {s.annee}</h2>
      <div className="table-wrap">
        {C.liste.length === 0 ? <p className="muted" style={{ padding: '1rem' }}>Aucune classe pour cette année scolaire.</p> : (
          <table>
            <caption className="sr-only">Effectifs, remplissage et absences par classe</caption>
            <thead><tr><th scope="col">Classe</th><th scope="col">Titulaire</th><th scope="col">Élèves actifs</th><th scope="col">Capacité</th><th scope="col">Remplissage</th><th scope="col">Absences</th></tr></thead>
            <tbody>{C.liste.map((c) => <tr key={c.id}><th scope="row">{c.nom}</th><td>{c.titulaire || '—'}</td><td>{fmt(c.effectif)}</td><td>{fmt(c.capacite)}</td><td>{nd(c.remplissage, ' %')}</td><td>{fmt(c.absences)}</td></tr>)}</tbody>
          </table>)}
      </div>
      <p className="muted small" style={{ marginTop: '1rem' }}>Seules les données de votre école sont affichées. L'application n'enregistre que les absences : les présences sont déduites (élèves actifs scolarisés moins élèves absents), et le taux du mois est une estimation sur les jours de classe du mois (lundi à samedi, une demi-journée d'absence compte pour 0,5).</p>
    </div>
  );
}

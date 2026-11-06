import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Bars, Donut } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import SchoolSelect from '../components/SchoolSelect.jsx';
import { Alert, PageHeader, Pill, Spinner } from '../components/ui.jsx';

// Une couleur par école (stable : liée à l'identifiant, donc identique dans les cartes, les barres et le détail)
const PALETTE = ['#2563EB', '#E11D48', '#059669', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#9333EA'];
const STATUT = { active: ['Active', '#16A34A', 'ok'], suspended: ['Suspendue', '#DC2626', 'bad'], trial: ['En essai', '#F59E0B', 'warn'] };
const ROLES = [['directeurs', 'Directeurs', '#1B2F5B'], ['enseignants', 'Enseignants', '#0891B2'], ['parents', 'Parents', '#D97706'], ['comptables', 'Comptables', '#7C3AED'], ['comptes_eleves', 'Comptes élèves', '#16A34A']];
const REFRESH_MS = 15000;

function Kpi({ n, label, icon, tone = 'brand', sub }) {
  return <div className="stat stat-link" style={{ cursor: 'default' }}><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{Number(n).toLocaleString('fr-FR')}</b><span className="stat-label">{label}</span>{sub && <span className="stat-label small">{sub}</span>}</span></div>;
}

export default function StatsGlobales() {
  const { user } = useAuth();
  const [g, setG] = useState(null); const [err, setErr] = useState(''); const [choix, setChoix] = useState(''); // slug de l'école consultée
  const [maj, setMaj] = useState(null); const [live, setLive] = useState(false);
  const timer = useRef(); const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return; busy.current = true; setLive(true);
    try { setG(await api('/stats/global')); setErr(''); setMaj(new Date()); } catch (e) { setErr(e.message); } finally { busy.current = false; setTimeout(() => setLive(false), 400); }
  }, []);
  // Actualisation automatique : à l'ouverture, après CHAQUE modification faite dans l'application (événement émis par api()),
  // à intervalle régulier (modifications faites par d'autres comptes) et au retour sur l'onglet.
  useEffect(() => {
    load();
    const onChange = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); };
    const onVis = () => document.visibilityState === 'visible' && load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    window.addEventListener('data:changed', onChange); document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); clearTimeout(timer.current); window.removeEventListener('data:changed', onChange); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (err && !g) return <Alert>{err}</Alert>;
  if (!g) return <Spinner />;
  const superAdmin = user.role === 'superadmin';
  const couleur = (e) => PALETTE[g.ecoles.map((x) => x.id).sort((a, b) => a - b).indexOf(e.id) % PALETTE.length];
  const liste = g.ecoles.map((e) => ({ ...e, color: couleur(e) }));
  const sel = liste.find((e) => e.slug === choix) || null;
  const T = g.totaux;
  const barres = (k) => liste.map((e) => ({ key: e.id, label: e.nom.replace(/^École Primaire /, ''), value: e[k], color: e.color, active: !sel || sel.id === e.id }));

  return (
    <div>
      <PageHeader title="Statistiques globales" subtitle="Toutes les écoles de la plateforme, calculées en direct à partir de la base de données.">
        <span className={`live${live ? ' on' : ''}`} role="status"><span className="live-dot" aria-hidden="true" />{maj ? `Mis à jour à ${maj.toLocaleTimeString('fr-FR')}` : 'Chargement…'}</span>
        <button type="button" className="btn sec sm" onClick={load}>Actualiser</button>
      </PageHeader>
      <Alert>{err}</Alert>

      <div className="grid">
        <Kpi n={T.ecoles} label="Écoles" icon="building" />
        <Kpi n={T.directeurs} label="Directeurs" icon="key" />
        <Kpi n={T.utilisateurs} label="Utilisateurs (tous comptes)" icon="users" sub={`dont ${T.superadmins} super-administrateur${T.superadmins > 1 ? 's' : ''}`} />
        <Kpi n={T.eleves} label="Élèves" icon="graduation" sub={`${T.eleves_actifs} actifs · ${T.classes} classes`} />
      </div>
      <div className="grid" style={{ marginTop: '1rem' }}>
        <Kpi n={g.statuts.active} label="Écoles actives" icon="check-circle" tone="ok" />
        <Kpi n={g.statuts.trial} label="Écoles en période d'essai" icon="clock" tone="warn" />
        <Kpi n={g.statuts.suspended} label="Écoles suspendues" icon="alert-triangle" tone="bad" />
        {T.expirees > 0 && <Kpi n={T.expirees} label="Abonnements expirés" icon="alert-circle" tone="bad" />}
      </div>

      <h2 className="section-title">Graphiques</h2>
      <div className="grid charts">
        <div className="card"><Donut title="Écoles par statut" data={Object.entries(STATUT).map(([k, [label, color]]) => ({ label, color, value: g.statuts[k] || 0 }))} /></div>
        <div className="card"><Donut title="Utilisateurs par rôle" center={T.utilisateurs.toLocaleString('fr-FR')} data={[...ROLES.map(([k, label, color]) => ({ label, color, value: T[k] })), { label: 'Super-administrateurs', color: '#64748B', value: T.superadmins }]} /></div>
        <div className="card"><Donut title="Élèves par école" data={liste.map((e) => ({ label: e.nom.replace(/^École Primaire /, ''), color: e.color, value: e.eleves }))} /></div>
        <div className="card wide2"><Bars title="Élèves par école" data={barres('eleves')} /></div>
        <div className="card wide2"><Bars title="Utilisateurs par école" data={barres('utilisateurs')} /></div>
      </div>

      <h2 className="section-title">Consulter une école</h2>
      <div className="filters"><div>
        <label htmlFor="stats-ecole">École</label>
        <SchoolSelect id="stats-ecole" schools={liste} value={choix} onChange={setChoix} emptyLabel={`Toutes les écoles (${liste.length})`} />
      </div></div>

      {sel && <Detail e={sel} superAdmin={superAdmin} onClose={() => setChoix('')} />}

      <div className="grid school-cards">
        {liste.filter((e) => !sel || sel.id === e.id).map((e) => {
          const [slabel, , tone] = STATUT[e.status] || ['', '', ''];
          return (
            <article key={e.id} className={`card school-card${e.mon_ecole ? ' mine' : ''}`} style={{ '--school': e.color }} aria-label={e.label}>
              <header><span className="school-dot" aria-hidden="true" /><div><h3>{e.nom}</h3><div className="muted small">{e.ville || '—'}{e.mon_ecole ? ' · votre école' : ''}</div></div><Pill kind={tone}>{slabel}</Pill></header>
              <dl>
                <div><dt>Directeurs</dt><dd>{e.directeurs}</dd></div><div><dt>Enseignants</dt><dd>{e.enseignants}</dd></div>
                <div><dt>Élèves</dt><dd>{e.eleves}</dd></div><div><dt>Classes</dt><dd>{e.classes}</dd></div>
                <div><dt>Utilisateurs</dt><dd>{e.utilisateurs}</dd></div><div><dt>Parents</dt><dd>{e.parents}</dd></div>
              </dl>
              {!sel && <button type="button" className="btn sec sm" onClick={() => setChoix(e.slug)}>Voir le détail</button>}
            </article>);
        })}
      </div>
      {e0(user) && <p className="muted small" style={{ marginTop: '1rem' }}>Les compteurs de toutes les écoles sont visibles ; les données détaillées (élèves, parents, finances) restent propres à chaque école. <Link to="/">Retour à mon tableau de bord</Link></p>}
    </div>
  );
}
const e0 = (u) => u.role === 'admin';

function Detail({ e, superAdmin, onClose }) {
  const [slabel, , tone] = STATUT[e.status] || ['', '', ''];
  const statutsEleves = [['actif', 'Actifs', '#16A34A'], ['inactif', 'Inactifs', '#F59E0B'], ['diplome', 'Diplômés', '#2563EB']];
  return (
    <section className="card detail" style={{ '--school': e.color }} aria-label={`Détail : ${e.label}`}>
      <header className="detail-head">
        <span className="school-dot big" aria-hidden="true" />
        <div style={{ flex: 1 }}><h2 style={{ margin: 0 }}>{e.label}</h2><div className="muted small">Formule {e.plan} · fin d'abonnement {e.subscription_end ? fmtDate(e.subscription_end) : '—'} · {e.preinscriptions_attente} pré-inscription(s) en attente</div></div>
        <Pill kind={tone}>{slabel}</Pill><button type="button" className="btn sec sm" onClick={onClose}>Toutes les écoles</button>
      </header>
      <div className="grid charts">
        <Donut title="Utilisateurs par rôle" data={ROLES.map(([k, label, color]) => ({ label, color, value: e[k] }))} />
        <Donut title="Élèves par statut" data={statutsEleves.map(([k, label, color]) => ({ label, color, value: e.eleves_par_statut[k] || 0 }))} />
        <Bars title="Effectifs" data={[['Élèves', e.eleves], ['Utilisateurs', e.utilisateurs], ['Parents', e.parents], ['Enseignants', e.enseignants], ['Classes', e.classes]].map(([label, value]) => ({ label, value, color: e.color }))} />
      </div>
      {superAdmin && <div style={{ marginTop: '1rem' }}><h3>Directeurs</h3>
        {e.liste_directeurs.length === 0 ? <p className="muted">Aucun directeur.</p> : <ul className="plain">{e.liste_directeurs.map((d) => <li key={d.id}><b>{d.nom}</b> · {d.email} {!d.actif && <Pill kind="bad">Inactif</Pill>}</li>)}</ul>}</div>}
    </section>
  );
}

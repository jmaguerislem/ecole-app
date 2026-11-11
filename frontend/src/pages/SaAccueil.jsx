import { Link } from 'react-router-dom';
import { Donut, StackedBars } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, PageHeader, Pill, Spinner } from '../components/ui.jsx';
import { useLive } from '../useLive.js';

const ROLES = { admin: ['Administrateurs', '#1B2F5B'], comptable: ['Comptables', '#7C3AED'], enseignant: ['Enseignants', '#0891B2'], parent: ['Parents', '#D97706'], eleve: ['Élèves', '#16A34A'] };
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

function Kpi({ n, label, icon, tone = 'brand', sub }) {
  return <div className="stat stat-link" style={{ cursor: 'default' }}><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{fmt(n)}</b><span className="stat-label">{label}</span>{sub && <span className="stat-label small">{sub}</span>}</span></div>;
}

// Accueil du super-administrateur : nouveau tableau de bord. Aucun chiffre n'est écrit en dur : tout vient de GET /api/saas/dashboard (base de données).
export default function SaAccueil() {
  const { data: d, err, maj, reload } = useLive('/saas/dashboard');
  if (err && !d) return <Alert>{err}</Alert>;
  if (!d) return <Spinner />;
  const T = d.totaux;
  const cats = Object.entries(ROLES).map(([key, [label, color]]) => ({ key, label, color }));
  const rows = d.ecoles.map((e) => ({ key: e.id, label: e.nom.replace(/^École Primaire /, ''), values: e.par_role }));
  return (
    <div>
      <PageHeader title="Accueil" subtitle="Vue d'ensemble de la plateforme, calculée en direct à partir de la base de données.">
        <span className="live" role="status"><span className="live-dot" aria-hidden="true" />{maj ? `Mis à jour à ${maj.toLocaleTimeString('fr-FR')}` : 'Chargement…'}</span>
        <button type="button" className="btn sec sm" onClick={reload}>Actualiser</button>
      </PageHeader>
      <Alert>{err}</Alert>

      <div className="grid">
        <Kpi n={T.ecoles} label="Écoles" icon="building" />
        <Kpi n={T.utilisateurs} label="Utilisateurs" icon="users" sub="comptes des écoles, hors super-administrateur" />
        <Kpi n={T.ecoles_actives} label="Écoles actives" icon="check-circle" tone="ok" sub={T.dont_essai ? `dont ${T.dont_essai} en période d'essai` : 'abonnement en cours'} />
        <Kpi n={T.ecoles_inactives} label="Écoles inactives" icon="alert-triangle" tone={T.ecoles_inactives ? 'bad' : 'brand'} sub={`${T.dont_suspendues} suspendue(s) · ${T.dont_expirees} expirée(s)`} />
      </div>

      <h2 className="section-title">Répartition des utilisateurs</h2>
      <div className="grid charts">
        <div className="card"><Donut title="Utilisateurs par rôle" center={fmt(T.utilisateurs)} data={d.roles.map((r) => ({ label: r.label, color: ROLES[r.role][1], value: r.n }))} /></div>
        <div className="card"><Donut title="Écoles actives et inactives" center={fmt(T.ecoles)} data={[{ label: 'Actives', color: '#16A34A', value: T.ecoles_actives }, { label: 'Inactives', color: '#DC2626', value: T.ecoles_inactives }]} /></div>
        <div className="card wide2"><StackedBars title="Utilisateurs par rôle et par école" cats={cats} rows={rows} /></div>
      </div>

      <h2 className="section-title">Détail par école</h2>
      <div className="table-wrap stack"><table>
        <thead><tr><th>École</th><th>Statut</th>{cats.map((c) => <th key={c.key}>{c.label}</th>)}<th>Total</th></tr></thead>
        <tbody>
          {d.ecoles.length === 0 && <tr><td colSpan={3 + cats.length} className="empty">Aucune école.</td></tr>}
          {d.ecoles.map((e) => (
            <tr key={e.id}>
              <td data-label="École"><b>{e.nom}</b><div className="muted small">{e.ville || '—'}</div></td>
              <td data-label="Statut"><Pill kind={e.ouverte ? (e.status === 'trial' ? 'warn' : 'ok') : 'bad'}>{e.status === 'suspended' ? 'Suspendue' : !e.ouverte ? 'Expirée' : e.status === 'trial' ? 'Essai' : 'Active'}</Pill></td>
              {cats.map((c) => <td key={c.key} data-label={c.label}>{fmt(e.par_role[c.key])}</td>)}
              <td data-label="Total"><b>{fmt(e.utilisateurs)}</b></td>
            </tr>))}
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: '1rem' }}>« Active » : abonnement en cours (statut Actif ou Essai) ; « inactive » : école suspendue ou abonnement expiré. <Link to="/ecoles">Gérer les écoles</Link></p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Avatar, PageHeader, Pill, Spinner } from '../components/ui.jsx';

// Raccourcis : uniquement des pages déjà autorisées pour le rôle dans le menu
const RACCOURCIS = {
  admin: [['/annonces', 'Annonces', 'megaphone'], ['/paiements', 'Paiements', 'credit-card'], ['/preinscriptions', 'Pré-inscriptions', 'user-plus']],
  comptable: [['/paiements', 'Paiements', 'credit-card'], ['/eleves', 'Élèves', 'graduation'], ['/tarifs', 'Tarifs', 'tag'], ['/preinscriptions', 'Pré-inscriptions', 'user-plus']],
  enseignant: [['/appel', "Faire l'appel", 'list-checks'], ['/evaluations', 'Évaluations & notes', 'clipboard'], ['/devoirs', 'Devoirs', 'pencil'], ['/emploi-du-temps', 'Emploi du temps', 'calendar']],
  parent: [['/bulletins', 'Bulletins', 'file-text'], ['/devoirs', 'Devoirs', 'pencil'], ['/paiements', 'Paiements', 'credit-card'], ['/messagerie', 'Messagerie', 'message']],
  eleve: [['/emploi-du-temps', 'Emploi du temps', 'calendar'], ['/devoirs', 'Devoirs', 'pencil'], ['/absences', 'Absences', 'user-x'], ['/messagerie', 'Messagerie', 'message']],
};

const Montant = ({ v }) => <>{Number(v || 0).toFixed(2)}<small className="unit"> TND</small></>;

function Stat({ n, label, to, icon, tone = 'brand' }) {
  const body = <><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{n}</b><span className="stat-label">{label}</span></span></>;
  return to ? <Link to={to} className="stat stat-link">{body}</Link> : <div className="stat stat-link" style={{ cursor: 'default' }}>{body}</div>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Alert>{err}</Alert>;
  if (!d) return <Spinner />;
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div>
      <PageHeader title={`Bonjour ${user.prenom}`} subtitle={`Année scolaire ${d.annee} · ${date}`} />

      {(d.role === 'admin' || d.role === 'comptable') && <div className="grid">
        <Stat n={d.eleves} label="Élèves actifs" to="/eleves" icon="graduation" />
        <Stat n={d.classes} label="Classes" to="/classes" icon="school" />
        <Stat n={d.enseignants} label="Enseignants" to="/enseignants" icon="presentation" />
        <Stat n={<Montant v={d.paiements_mois} />} label="Encaissé ce mois" to="/paiements" icon="banknote" tone="ok" />
        <Stat n={d.impayes} label={`Élèves avec impayé (${money(d.total_impaye)})`} to="/paiements" icon="alert-triangle" tone={d.impayes > 0 ? 'bad' : 'ok'} />
        <Stat n={d.preinscriptions_attente} label="Pré-inscriptions en attente" to="/preinscriptions" icon="user-plus" tone={d.preinscriptions_attente > 0 ? 'warn' : 'brand'} />
      </div>}

      {d.role === 'enseignant' && <div className="grid">
        <Stat n={d.classes} label="Mes classes" icon="school" />
        <Stat n={d.devoirs_en_cours} label="Devoirs en cours" to="/devoirs" icon="pencil" />
        <Stat n={d.cours_aujourdhui} label="Cours aujourd'hui" to="/emploi-du-temps" icon="calendar" />
      </div>}

      {(d.role === 'parent' || d.role === 'eleve') && (d.enfants.length === 0
        ? <div className="card">Aucun élève rattaché à votre compte. Contactez l'administration.</div>
        : <div className="grid">{d.enfants.map((e) => (
          <div key={e.id} className="card">
            <div className="child-head"><Avatar prenom={e.prenom} nom={e.nom} size={44} /><div><h3>{e.prenom} {e.nom}</h3><div className="muted small">{e.classe_nom || 'Sans classe'}</div></div></div>
            <div className="kv"><span>Devoirs à rendre</span><b>{e.devoirs_a_rendre}</b></div>
            {e.solde !== undefined && <div className="kv"><span>Solde à payer</span><Pill kind={e.solde > 0 ? 'bad' : 'ok'}>{money(e.solde)}</Pill></div>}
            <div className="row" style={{ marginTop: '.9rem' }}><Link className="btn sec sm" to="/bulletins"><Icon name="file-text" size={15} />Bulletin</Link><Link className="btn sec sm" to="/devoirs"><Icon name="pencil" size={15} />Devoirs</Link></div>
          </div>))}</div>)}

      {RACCOURCIS[user.role] && <>
        <h2 className="section-title">Raccourcis</h2>
        <nav aria-label="Raccourcis"><ul className="shortcuts">
          {RACCOURCIS[user.role].map(([to, label, icon]) => <li key={to}><Link to={to} className="shortcut"><Icon name={icon} size={20} />{label}<Icon name="arrow-right" size={16} className="go" /></Link></li>)}
        </ul></nav>
      </>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../auth.jsx';

const Stat = ({ n, label, to }) => <div className="stat"><b>{n}</b>{to ? <Link to={to}>{label}</Link> : <span>{label}</span>}</div>;
export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="alert err">{err}</div>;
  if (!d) return <p>Chargement…</p>;
  return (
    <div>
      <h1>Bonjour {user.prenom}</h1>
      <p className="muted">Année scolaire {d.annee}</p>
      {(d.role === 'admin' || d.role === 'comptable') && <div className="grid">
        <Stat n={d.eleves} label="Élèves actifs" to="/eleves" /><Stat n={d.classes} label="Classes" to="/classes" /><Stat n={d.enseignants} label="Enseignants" to="/enseignants" />
        <Stat n={money(d.paiements_mois)} label="Encaissé ce mois" to="/paiements" /><Stat n={d.impayes} label={`Élèves avec impayé (${money(d.total_impaye)})`} to="/paiements" /><Stat n={d.preinscriptions_attente} label="Pré-inscriptions en attente" to="/preinscriptions" />
      </div>}
      {d.role === 'enseignant' && <div className="grid"><Stat n={d.classes} label="Mes classes" /><Stat n={d.devoirs_en_cours} label="Devoirs en cours" to="/devoirs" /><Stat n={d.cours_aujourdhui} label="Cours aujourd'hui" to="/emploi-du-temps" /></div>}
      {(d.role === 'parent' || d.role === 'eleve') && (d.enfants.length === 0 ? <div className="card">Aucun élève rattaché à votre compte. Contactez l'administration.</div> :
        <div className="grid">{d.enfants.map((e) => (
          <div key={e.id} className="card"><h3>{e.prenom} {e.nom}</h3><div className="muted">{e.classe_nom || 'Sans classe'}</div>
            <p>Devoirs à rendre : <b>{e.devoirs_a_rendre}</b></p>
            {e.solde !== undefined && <p>Solde à payer : <b style={{ color: e.solde > 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(e.solde)}</b></p>}
            <div className="row"><Link to="/bulletins">Bulletin</Link><Link to="/devoirs">Devoirs</Link></div></div>))}</div>)}
    </div>
  );
}

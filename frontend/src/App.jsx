import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, download, ROLES } from './api.js';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Preinscription from './pages/Preinscription.jsx';
import Dashboard from './pages/Dashboard.jsx';
import * as P from './pages/Entities.jsx';
import Notes from './pages/Notes.jsx';
import Bulletins from './pages/Bulletins.jsx';
import Timetable from './pages/Timetable.jsx';
import Paiements from './pages/Paiements.jsx';
import Messagerie from './pages/Messagerie.jsx';
import Annonces from './pages/Annonces.jsx';
import Devoirs from './pages/Devoirs.jsx';
import Journaux from './pages/Journaux.jsx';
import Compte from './pages/Compte.jsx';
import Appel from './pages/Appel.jsx';
import Ecoles from './pages/Ecoles.jsx';

// Menu par rôle (RBAC côté interface – le serveur applique de toute façon les droits)
const NAV = [
  ['/', 'Tableau de bord', ['admin', 'comptable', 'enseignant', 'parent', 'eleve']],
  ['/eleves', 'Élèves', ['admin', 'comptable', 'enseignant']],
  ['/preinscriptions', 'Pré-inscriptions', ['admin', 'comptable']],
  ['/classes', 'Classes', ['admin', 'enseignant']],
  ['/matieres', 'Matières', ['admin', 'enseignant']],
  ['/salles', 'Salles', ['admin']],
  ['/affectations', 'Affectations', ['admin']],
  ['/enseignants', 'Enseignants', ['admin']],
  ['/parents', 'Parents', ['admin', 'comptable']],
  ['/comptes', 'Tous les comptes', ['admin']],
  ['/emploi-du-temps', 'Emploi du temps', ['admin', 'enseignant', 'parent', 'eleve']],
  ['/evaluations', 'Évaluations & notes', ['admin', 'enseignant']],
  ['/bulletins', 'Bulletins', ['admin', 'enseignant', 'parent']],
  ['/ecoles', 'Écoles', ['superadmin']],
  ['/appel', "Faire l'appel", ['admin', 'enseignant']],
  ['/absences', 'Absences', ['admin', 'enseignant', 'parent', 'eleve']],
  ['/devoirs', 'Devoirs', ['admin', 'enseignant', 'parent', 'eleve']],
  ['/tarifs', 'Tarifs', ['admin', 'comptable']],
  ['/paiements', 'Paiements', ['admin', 'comptable', 'parent']],
  ['/messagerie', 'Messagerie', ['admin', 'comptable', 'enseignant', 'parent', 'eleve']],
  ['/annonces', 'Annonces', ['admin', 'comptable', 'enseignant', 'parent', 'eleve']],
  ['/journaux', "Journaux d'audit", ['admin']],
];

function Layout({ children }) {
  const { user, config, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const f = () => api('/notifications/count').then((r) => setCount(r.non_lues)).catch(() => {});
    f(); const t = setInterval(f, 30000); return () => clearInterval(t);
  }, [loc.pathname]);
  return (
    <div className="shell">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Navigation principale">
        <div className="brand">{user.school?.nom || config.ecoleNom}<small>Année {config.anneeCourante}</small></div>
        <nav>{NAV.filter((n) => n[2].includes(user.role)).map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav>
      </aside>
      <div className="main">
        <header className="top">
          <button className="btn sec sm menu-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>☰</button>
          <div className="grow" />
          <button className="btn sec sm bell" onClick={() => nav('/notifications')} aria-label={`Notifications (${count} non lues)`}>🔔{count > 0 && <span className="badge">{count}</span>}</button>
          <NavLink to="/compte" className="small">{user.prenom} {user.nom} <span className="muted">({ROLES[user.role]})</span></NavLink>
          <button className="btn sec sm" onClick={() => { logout(); nav('/login'); }}>Déconnexion</button>
        </header>
        <main id="contenu" className="content">{children}</main>
      </div>
    </div>
  );
}

function Notifications() {
  const [list, setList] = useState(null);
  const nav = useNavigate();
  const load = () => api('/notifications').then(setList);
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="row between"><h1>Notifications</h1><button className="btn sec" onClick={() => api('/notifications/lu-tout', { method: 'POST' }).then(load)}>Tout marquer comme lu</button></div>
      {list?.length === 0 && <div className="card empty">Aucune notification.</div>}
      {list?.map((n) => (
        <div key={n.id} className="card" style={{ borderLeft: `4px solid ${n.lu ? 'var(--line)' : 'var(--margin)'}`, cursor: n.lien ? 'pointer' : 'default' }}
          onClick={() => { api(`/notifications/${n.id}/lu`, { method: 'POST' }); if (n.lien) nav(n.lien); }}>
          <b>{n.titre}</b><div>{n.corps}</div><div className="muted small">{new Date(n.created_at).toLocaleString('fr-FR')}</div>
        </div>))}
    </div>
  );
}
function RecuDownload() {
  const { id } = useParams(); const nav = useNavigate();
  useEffect(() => { download(`/paiements/${id}/recu`, `recu-${id}.pdf`, true).catch(() => {}).finally(() => nav('/paiements', { replace: true })); }, [id, nav]);
  return <p>Ouverture du reçu…</p>;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <p style={{ padding: '2rem' }}>Chargement…</p>;
  const guard = (el) => (user ? <Layout>{el}</Layout> : <Navigate to="/login" replace />);
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/preinscription" element={<Preinscription />} />
      <Route path="/preinscription/:slug" element={<Preinscription />} />
      <Route path="/" element={user?.role === 'superadmin' ? <Navigate to="/ecoles" replace /> : guard(<Dashboard />)} />
      <Route path="/ecoles" element={guard(<Ecoles />)} />
      <Route path="/eleves" element={guard(<P.Eleves />)} />
      <Route path="/preinscriptions" element={guard(<P.Preinscriptions />)} />
      <Route path="/classes" element={guard(<P.Classes />)} />
      <Route path="/matieres" element={guard(<P.Matieres />)} />
      <Route path="/salles" element={guard(<P.Salles />)} />
      <Route path="/affectations" element={guard(<P.Affectations />)} />
      <Route path="/enseignants" element={guard(<P.Enseignants />)} />
      <Route path="/parents" element={guard(<P.Parents />)} />
      <Route path="/comptes" element={guard(<P.Comptes />)} />
      <Route path="/emploi-du-temps" element={guard(<Timetable />)} />
      <Route path="/evaluations" element={guard(<P.Evaluations />)} />
      <Route path="/notes/:id" element={guard(<Notes />)} />
      <Route path="/bulletins" element={guard(<Bulletins />)} />
      <Route path="/appel" element={guard(<Appel />)} />
      <Route path="/absences" element={guard(<P.Absences />)} />
      <Route path="/devoirs" element={guard(<Devoirs />)} />
      <Route path="/tarifs" element={guard(<P.Tarifs />)} />
      <Route path="/paiements" element={guard(<Paiements />)} />
      <Route path="/recu/:id" element={guard(<RecuDownload />)} />
      <Route path="/messagerie" element={guard(<Messagerie />)} />
      <Route path="/messagerie/:id" element={guard(<Messagerie />)} />
      <Route path="/annonces" element={guard(<Annonces />)} />
      <Route path="/journaux" element={guard(<Journaux />)} />
      <Route path="/notifications" element={guard(<Notifications />)} />
      <Route path="/compte" element={guard(<Compte />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, download, ROLES } from './api.js';
import { useAuth } from './auth.jsx';
import Icon from './components/Icon.jsx';
import { Avatar, EmptyState, PageHeader, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Preinscription from './pages/Preinscription.jsx';
import Inscription from './pages/Inscription.jsx';
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
import StatsGlobales from './pages/StatsGlobales.jsx';
import StatsEcole from './pages/StatsEcole.jsx';

// Menu par rôle (RBAC côté interface – le serveur applique de toute façon les droits).
// Les entrées sont regroupées par domaine pour réduire la charge de lecture d'un menu de 22 liens.
const TOUS = ['admin', 'comptable', 'enseignant', 'parent', 'eleve'];
const NAV = [
  { title: 'Pilotage', items: [
    ['/', 'Tableau de bord', 'dashboard', TOUS],
    ['/statistiques', 'Statistiques globales', 'dashboard', ['superadmin']], // toutes les écoles : super-administrateur
    ['/statistiques', "Statistiques de l'école", 'dashboard', ['admin']], // le directeur ne voit que SON école
    ['/ecoles', 'Écoles', 'building', ['superadmin']],
  ] },
  { title: 'Scolarité', items: [
    ['/eleves', 'Élèves', 'graduation', ['admin', 'comptable', 'enseignant']],
    ['/preinscriptions', 'Pré-inscriptions', 'user-plus', ['admin', 'comptable']],
    ['/classes', 'Classes', 'school', ['admin', 'enseignant']],
    ['/matieres', 'Matières', 'book', ['admin', 'enseignant']],
    ['/salles', 'Salles', 'door', ['admin']],
    ['/affectations', 'Affectations', 'link', ['admin']],
    ['/emploi-du-temps', 'Emploi du temps', 'calendar', ['admin', 'enseignant', 'parent', 'eleve']],
    ['/evaluations', 'Évaluations & notes', 'clipboard', ['admin', 'enseignant']],
    ['/bulletins', 'Bulletins', 'file-text', ['admin', 'enseignant', 'parent']],
  ] },
  { title: 'Vie scolaire', items: [
    ['/appel', "Faire l'appel", 'list-checks', ['enseignant']],
    ['/absences', 'Absences', 'user-x', ['admin', 'enseignant', 'parent', 'eleve']],
    ['/devoirs', 'Devoirs', 'pencil', ['admin', 'enseignant', 'parent', 'eleve']],
  ] },
  { title: 'Communication', items: [
    ['/messagerie', 'Messagerie', 'message', TOUS],
    ['/annonces', 'Annonces', 'megaphone', TOUS],
  ] },
  { title: 'Finances', items: [
    ['/tarifs', 'Tarifs', 'tag', ['admin', 'comptable']],
    ['/paiements', 'Paiements', 'credit-card', ['admin', 'comptable', 'parent']],
  ] },
  { title: 'Administration', items: [
    ['/enseignants', 'Enseignants', 'presentation', ['admin']],
    ['/parents', 'Parents', 'users', ['admin', 'comptable']],
    ['/comptes', 'Tous les comptes', 'key', ['admin']],
    ['/journaux', "Journaux d'audit", 'history', ['admin']],
  ] },
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
  // Tiroir mobile : Échap pour fermer, défilement de la page verrouillé tant qu'il est ouvert
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [open]);

  const school = user.school?.label || user.school?.nom || config.ecoleNom; // même libellé « Nom (Ville) » que dans les listes d'écoles
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i[3].includes(user.role)) })).filter((g) => g.items.length);
  return (
    <div className="shell">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <aside id="menu-lateral" className={`side${open ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="graduation" size={22} /></span>
          <div className="brand-text"><b>{school}</b><small>Année {config.anneeCourante}</small></div>
          <button type="button" className="icon-btn side-close" onClick={() => setOpen(false)} aria-label="Fermer le menu"><Icon name="x" /></button>
        </div>
        <nav aria-label="Navigation principale">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <p className="nav-title" id={`nav-${g.title}`}>{g.title}</p>
              <ul aria-labelledby={`nav-${g.title}`}>
                {g.items.map(([to, label, icon]) => <li key={to}><NavLink to={to} end={to === '/'}><Icon name={icon} size={19} />{label}</NavLink></li>)}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="main">
        <header className="top">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="menu-lateral"><Icon name="menu" /></button>
          <span className="top-school">{school}</span>
          <div className="grow" />
          <button type="button" className="icon-btn" onClick={() => nav('/notifications')} aria-label={count > 0 ? `Notifications : ${count} non lue${count > 1 ? 's' : ''}` : 'Notifications'}>
            <Icon name="bell" />{count > 0 && <span className="badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
          </button>
          <NavLink to="/compte" className="user-chip" aria-label={`Mon compte : ${user.prenom} ${user.nom}`}>
            <Avatar prenom={user.prenom} nom={user.nom} />
            <span className="user-meta"><b>{user.prenom} {user.nom}</b><small>{ROLES[user.role]}</small></span>
          </NavLink>
          <button type="button" className="btn sec sm" onClick={() => { logout(); nav('/login'); }} aria-label="Déconnexion"><Icon name="log-out" size={16} /><span className="hide-sm">Déconnexion</span></button>
        </header>
        <main id="contenu" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

function Notifications() {
  const [list, setList] = useState(null);
  const nav = useNavigate();
  const load = () => api('/notifications').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const ouvrir = (n) => {
    api(`/notifications/${n.id}/lu`, { method: 'POST' }).catch(() => {});
    setList((l) => l.map((x) => (x.id === n.id ? { ...x, lu: true } : x)));
    if (n.lien) nav(n.lien);
  };
  return (
    <div>
      <PageHeader title="Notifications"><button type="button" className="btn sec" onClick={() => api('/notifications/lu-tout', { method: 'POST' }).then(load)}><Icon name="check" size={16} />Tout marquer comme lu</button></PageHeader>
      {list === null && <Spinner />}
      {list?.length === 0 && <div className="card"><EmptyState icon="bell" title="Aucune notification">Vous êtes à jour.</EmptyState></div>}
      <ul className="notif-list">
        {list?.map((n) => (
          <li key={n.id}>
            <button type="button" className={`notif${n.lu ? '' : ' unread'}`} onClick={() => ouvrir(n)}>
              <span className="dot" aria-hidden="true" />
              <span><b>{n.titre}{!n.lu && <span className="sr-only"> (non lue)</span>}</b><span>{n.corps}</span><span className="muted small">{new Date(n.created_at).toLocaleString('fr-FR')}</span></span>
            </button>
          </li>))}
      </ul>
    </div>
  );
}
function RecuDownload() {
  const { id } = useParams(); const nav = useNavigate();
  useEffect(() => { download(`/paiements/${id}/recu`, `recu-${id}.pdf`, true).catch(() => {}).finally(() => nav('/paiements', { replace: true })); }, [id, nav]);
  return <Spinner label="Ouverture du reçu…" />;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div style={{ padding: '3rem 1.5rem' }}><Spinner /></div>;
  const guard = (el) => (user ? <Layout>{el}</Layout> : <Navigate to="/login" replace />);
  // Page réservée à certains rôles : les autres sont renvoyés à l'accueil (le serveur refuse aussi l'accès)
  const guardRoles = (roles, el) => (user && !roles.includes(user.role) ? <Navigate to="/" replace /> : guard(el));
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/inscription" element={user ? <Navigate to="/" replace /> : <Inscription />} />
      <Route path="/preinscription" element={<Preinscription />} />
      <Route path="/preinscription/:slug" element={<Preinscription />} />
      <Route path="/" element={user?.role === 'superadmin' ? <Navigate to="/statistiques" replace /> : guard(<Dashboard />)} />
      <Route path="/statistiques" element={guardRoles(['admin', 'superadmin'], user?.role === 'superadmin' ? <StatsGlobales /> : <StatsEcole />)} />
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
      <Route path="/appel" element={guardRoles(['enseignant'], <Appel />)} />
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

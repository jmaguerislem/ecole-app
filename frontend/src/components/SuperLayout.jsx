import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import { AuthImage } from './EleveFields.jsx';
import { Avatar } from './ui.jsx';

const PAGES = [['/', 'Accueil', 'dashboard'], ['/ecoles', 'Les écoles', 'building'], ['/finances', 'Statistiques financières', 'banknote']];

// Mise en page du super-administrateur : pas de menu latéral, un seul menu déroulant avec les trois pages principales.
export default function SuperLayout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation(); const nav = useNavigate();
  const [open, setOpen] = useState(false); const box = useRef();
  const courant = PAGES.find(([to]) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)));
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    const out = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', esc); document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', out); };
  }, [open]);
  return (
    <div className="super-shell">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <header className="top">
        <span className="brand-mark" aria-hidden="true"><Icon name="graduation" size={22} /></span>
        <b className="top-school" style={{ display: 'inline-block' }}>Espace propriétaire</b>
        <div className="menu-drop" ref={box}>
          <button type="button" className="btn sec" aria-haspopup="menu" aria-expanded={open} aria-controls="menu-sa" onClick={() => setOpen((o) => !o)}>
            <Icon name={courant?.[2] || 'menu'} size={16} />{courant?.[1] || 'Menu'}<Icon name="chevron-down" size={16} />
          </button>
          {open && <ul id="menu-sa" role="menu" className="menu-list">
            {PAGES.map(([to, label, icon]) => <li key={to} role="none"><NavLink role="menuitem" to={to} end={to === '/'}><Icon name={icon} size={18} />{label}</NavLink></li>)}
          </ul>}
        </div>
        <div className="grow" />
        <NavLink to="/profil" className="user-chip" aria-label={`Mon profil : ${user.prenom} ${user.nom}`}>
          <AuthImage key={user.photo || 'none'} src={user.photo} alt="" className="avatar-img" fallback={<Avatar prenom={user.prenom} nom={user.nom} />} />
          <span className="user-meta"><b>{user.prenom} {user.nom}</b><small>Mon profil</small></span>
        </NavLink>
        <button type="button" className="btn sec sm" onClick={() => { logout(); nav('/login'); }} aria-label="Déconnexion"><Icon name="log-out" size={16} /><span className="hide-sm">Déconnexion</span></button>
      </header>
      <main id="contenu" className="content" tabIndex={-1}>{children}</main>
    </div>
  );
}

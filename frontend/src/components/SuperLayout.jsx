import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import { AuthImage } from './EleveFields.jsx';
import { Avatar } from './ui.jsx';

const PAGES = [['/', 'Accueil', 'dashboard'], ['/ecoles', 'Les écoles', 'building'], ['/finances', 'Statistiques financières', 'banknote']];

// Mise en page du super-administrateur : même barre latérale bleue que l'espace école, avec les trois pages principales.
export default function SuperLayout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation(); const nav = useNavigate();
  const [open, setOpen] = useState(false); // tiroir de la barre latérale sur mobile

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <div className="shell">
      <a className="skip" href="#contenu">Aller au contenu</a>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`side${open ? ' open' : ''}`} id="menu-sa">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="graduation" size={22} /></span>
          <div className="brand-text">
            <b>Espace propriétaire</b>
            <small>Super-administration</small>
          </div>
        </div>
        <nav aria-label="Navigation principale">
          <div className="nav-group">
            <p className="nav-title">Navigation</p>
            <ul>
              {PAGES.map(([to, label, icon]) => (
                <li key={to}>
                  <NavLink to={to} end={to === '/'}><Icon name={icon} size={18} />{label}</NavLink>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </aside>
      <div className="main">
        <header className="top">
          <button type="button" className="icon-btn menu-btn" aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="menu-sa" onClick={() => setOpen(true)}>
            <Icon name="menu" size={22} />
          </button>
          <b className="top-school">Espace propriétaire</b>
          <div className="grow" />
          <NavLink to="/profil" className="user-chip" aria-label={`Mon profil : ${user.prenom} ${user.nom}`}>
            <AuthImage key={user.photo || 'none'} src={user.photo} alt="" className="avatar-img" fallback={<Avatar prenom={user.prenom} nom={user.nom} />} />
            <span className="user-meta"><b>{user.prenom} {user.nom}</b><small>Mon profil</small></span>
          </NavLink>
          <button type="button" className="btn sec sm" onClick={() => { logout(); nav('/login'); }} aria-label="Déconnexion"><Icon name="log-out" size={16} /><span className="hide-sm">Déconnexion</span></button>
        </header>
        <main id="contenu" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

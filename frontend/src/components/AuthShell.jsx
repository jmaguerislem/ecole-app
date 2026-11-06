import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';

const POINTS = [
  ['list-checks', "L'appel et les absences en quelques secondes, depuis un téléphone."],
  ['file-text', 'Notes et bulletins toujours à jour, consultables par les familles.'],
  ['shield', "Messagerie et données isolées : chaque école ne voit que ses propres informations."],
];

// Lien de retour : revient à la page précédente de l'historique ; sans historique (page ouverte directement), va à la connexion.
function BackLink() {
  const nav = useNavigate();
  const peutRevenir = (window.history.state?.idx ?? 0) > 0;
  return peutRevenir
    ? <button type="button" className="back-link linklike" onClick={() => nav(-1)}><Icon name="arrow-left" size={16} />Retour</button>
    : <Link className="back-link" to="/login"><Icon name="arrow-left" size={16} />Retour à la connexion</Link>;
}

// Mise en page commune des écrans publics (connexion, création d'école, pré-inscription).
// Variante « wide » : formulaire long, une seule colonne. Sinon : panneau de marque + formulaire.
export default function AuthShell({ title, subtitle, children, wide = false, school, back = false }) {
  const { config } = useAuth();
  const nom = school || config.ecoleNom || "Gestion d'école";
  const mark = <span className="brand-mark" aria-hidden="true"><Icon name="graduation" size={22} /></span>;

  if (wide) {
    return (
      <div className="auth single">
        <div className="auth-top">{mark}<span>{nom}</span></div>
        <main className="auth-main">
          <div className="auth-card wide">
            <div className="auth-panel">
              {back && <BackLink />}
              <h1>{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
              {children}
            </div>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="brand">{mark}<div className="brand-text"><b>{nom}</b>{config.anneeCourante && <small>Année {config.anneeCourante}</small>}</div></div>
        <div>
          <h2>Toute la vie de l'école, au même endroit.</h2>
          <ul className="auth-points">{POINTS.map(([icon, t]) => <li key={icon}><Icon name={icon} size={20} /><span>{t}</span></li>)}</ul>
        </div>
        <div className="auth-foot">Plateforme de gestion d'école primaire</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">{mark}<span>{nom}</span></div>
          {back && <BackLink />}
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

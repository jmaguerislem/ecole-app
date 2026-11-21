import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, PasswordInput } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

const ROLES_DEMO = [['admin', 'Administrateur', 'key'], ['comptable', 'Comptable', 'banknote'], ['eleve', 'Élève', 'graduation'], ['parent', 'Parent', 'users'], ['enseignant', 'Enseignant', 'presentation']];

// Comptes de démonstration : un clic ouvre la session d'un vrai compte de la base (le serveur connecte, aucun mot de passe n'est connu du navigateur).
// Le bloc n'apparaît que si le serveur l'autorise (désactivé en production sauf DEMO_LOGIN=true) et s'il existe des comptes (npm run seed:demo).
function ComptesDemo() {
  const { loginDemo } = useAuth();
  const [groupes, setGroupes] = useState(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api('/demo/accounts').then((r) => setGroupes(r.groupes || [])).catch(() => setGroupes([])); }, []);
  if (!groupes?.length) return null;
  const go = async (g, role) => {
    setBusy(`${g}-${role}`); setErr('');
    try { await loginDemo(g, role); } catch (x) { setErr(x.message); setBusy(''); }
  };
  return (
    <section className="demo" aria-labelledby="demo-titre">
      <h2 id="demo-titre">Comptes de démonstration</h2>
      <p className="muted small">Un clic pour entrer, sans saisir d'identifiants.</p>
      {groupes.map((g) => (
        <div className="demo-group" key={g.groupe} role="group" aria-label={`École ${g.groupe}`}>
          <div className="demo-school"><b>École {g.groupe}</b><span className="muted small" title={g.ecole}>{g.ecole.replace(/^École Primaire /, '')}</span></div>
          <div className="demo-roles">
            {ROLES_DEMO.filter(([r]) => g.roles.includes(r)).map(([r, label, icon]) => (
              <button key={r} type="button" className="demo-btn" disabled={!!busy} onClick={() => go(g.groupe, r)} aria-label={`École ${g.groupe} – ${label}`}>
                {busy === `${g.groupe}-${r}` ? <span className="spinner" aria-hidden="true" /> : <Icon name={icon} size={14} />}{label}
              </button>))}
          </div>
        </div>))}
      <Alert>{err}</Alert>
    </section>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [nonVerifie, setNonVerifie] = useState(false); // adresse e-mail d'une inscription pas encore confirmée
  const [ecoles, setEcoles] = useState(null); // écoles proposées quand la même adresse + le même mot de passe existent dans plusieurs écoles
  const [ecole, setEcole] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setNonVerifie(false);
    try { await login(email, password, ecole); }
    catch (x) {
      if (x.data?.code === 'school_required') { setEcoles(x.data.ecoles); setErr(ecole ? x.message : ''); } else { setEcoles(null); setErr(x.message); }
      setNonVerifie(x.data?.code === 'email_not_verified');
    } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Connexion" subtitle="Utilisez les identifiants remis par l'école.">
      <form onSubmit={submit}>
        <div className="form-field"><label htmlFor="email">Adresse e-mail</label><input id="email" type="email" required maxLength={120} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="form-field"><label htmlFor="pw">Mot de passe</label><PasswordInput id="pw" required maxLength={128} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {ecoles && <div className="form-field"><label htmlFor="ecole-login">Votre école <span className="req" aria-hidden="true">*</span></label>
          <select id="ecole-login" required value={ecole} onChange={(e) => setEcole(e.target.value)}><option value="">— Choisir votre école —</option>{ecoles.map((s) => <option key={s.slug} value={s.slug}>{s.nom}</option>)}</select>
          <div className="help">Cette adresse e-mail est utilisée dans plusieurs écoles : choisissez celle dans laquelle vous voulez entrer.</div></div>}
        <Alert>{err}</Alert>
        {nonVerifie && <p className="small"><Link to={`/verifier-email?email=${encodeURIComponent(email.trim())}`}>Saisir mon code de confirmation</Link></p>}
        <button className="btn block" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Connexion…</> : <><Icon name="log-in" size={16} />Se connecter</>}</button>
      </form>
      <ComptesDemo />
      <div className="auth-links">
        <p><Link to="/mot-de-passe-oublie">Mot de passe oublié ou première connexion ?</Link></p>
        <p>Nouvelle famille ? <Link to="/preinscription">Faire une demande de pré-inscription</Link></p>
        <p>Vous dirigez une école ? <Link to="/inscription">Essayez gratuitement pendant 30 jours</Link></p>
      </div>
    </AuthShell>
  );
}

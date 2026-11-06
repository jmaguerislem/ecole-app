import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, PasswordInput } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Connexion" subtitle="Utilisez les identifiants remis par l'école.">
      <form onSubmit={submit}>
        <div className="form-field"><label htmlFor="email">Adresse e-mail</label><input id="email" type="email" required maxLength={120} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="form-field"><label htmlFor="pw">Mot de passe</label><PasswordInput id="pw" required maxLength={128} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Alert>{err}</Alert>
        <button className="btn block" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Connexion…</> : <><Icon name="log-in" size={16} />Se connecter</>}</button>
      </form>
      <div className="auth-links">
        <p>Nouvelle famille ? <Link to="/preinscription">Faire une demande de pré-inscription</Link></p>
        <p>Vous dirigez une école ? <Link to="/inscription">Essayez gratuitement pendant 30 jours</Link></p>
      </div>
    </AuthShell>
  );
}

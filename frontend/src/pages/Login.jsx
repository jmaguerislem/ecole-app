import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/ui.jsx';

export default function Login() {
  const { login, config } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>{config.ecoleNom || 'Gestion d\'école'}</h1>
        <p className="muted">Connectez-vous avec les identifiants remis par l'école.</p>
        <div style={{ marginBottom: '.8rem' }}><label htmlFor="email">Adresse e-mail</label><input id="email" type="email" required maxLength={120} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div style={{ marginBottom: '.8rem' }}><label htmlFor="pw">Mot de passe</label><input id="pw" type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Alert>{err}</Alert>
        <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="small" style={{ marginTop: '1rem' }}>Nouvelle famille ? <Link to="/preinscription">Faire une demande de pré-inscription</Link></p>
        <p className="small">Vous dirigez une école ? <Link to="/inscription">Essayez gratuitement pendant 30 jours</Link></p>
      </form>
    </div>
  );
}

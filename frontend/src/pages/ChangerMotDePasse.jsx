import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, PasswordInput } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { MOT_DE_PASSE } from '../rules.js';

// Première connexion avec un mot de passe temporaire (reçu par e-mail) : choisir son propre mot de passe est obligatoire.
// Le serveur refuse de toute façon toute autre requête tant que ce n'est pas fait.
export default function ChangerMotDePasse() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ ancien: '', nouveau: '', confirmation: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.nouveau !== f.confirmation) return setErr('La confirmation ne correspond pas au nouveau mot de passe.');
    if (f.nouveau === f.ancien) return setErr("Le nouveau mot de passe doit être différent du mot de passe temporaire.");
    setBusy(true);
    try { await api('/auth/change-password', { method: 'POST', body: f }); await refresh(); nav('/', { replace: true }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Choisissez votre mot de passe" subtitle={`Bienvenue ${user.prenom} ! Pour votre sécurité, remplacez le mot de passe temporaire reçu par e-mail avant de continuer.`}>
      <form onSubmit={submit}>
        <div className="form-field"><label htmlFor="cp-o">Mot de passe temporaire</label><PasswordInput id="cp-o" required maxLength={128} autoComplete="current-password" value={f.ancien} onChange={(e) => setF({ ...f, ancien: e.target.value })} /></div>
        <div className="form-field"><label htmlFor="cp-n">Nouveau mot de passe</label><PasswordInput id="cp-n" required {...MOT_DE_PASSE} autoComplete="new-password" value={f.nouveau} onChange={(e) => setF({ ...f, nouveau: e.target.value })} /><div className="help">8 caractères minimum, avec au moins une lettre et un chiffre.</div></div>
        <div className="form-field"><label htmlFor="cp-c">Confirmer le nouveau mot de passe</label><PasswordInput id="cp-c" required maxLength={128} autoComplete="new-password" value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} /></div>
        <Alert>{err}</Alert>
        <button className="btn block" disabled={busy}>{busy ? 'Enregistrement…' : <><Icon name="check" size={16} />Enregistrer et continuer</>}</button>
      </form>
      <div className="auth-links"><p><button type="button" className="linklike" onClick={() => { logout(); nav('/login'); }}>Se déconnecter</button></p></div>
    </AuthShell>
  );
}

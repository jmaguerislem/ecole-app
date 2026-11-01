import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Alert } from '../components/ui.jsx';
import { EMAIL, LIBELLE, MOT_DE_PASSE } from '../rules.js';

// Inscription libre-service d'une école : essai gratuit de 30 jours
export default function Inscription() {
  const [v, setV] = useState({ nom: '', email: '', password: '', accepte: false });
  const [err, setErr] = useState(''); const [ok, setOk] = useState(null); const [busy, setBusy] = useState(false);
  const f = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { setOk(await api('/public/signup', { method: 'POST', body: { nom: v.nom, email: v.email, password: v.password } })); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Créer mon école</h1>
        {ok ? <>
          <Alert kind="ok">Votre école est créée. Essai gratuit de 30 jours (jusqu'au {new Date(ok.essai_jusqu_au).toLocaleDateString('fr-FR')}). Connectez-vous avec votre e-mail et votre mot de passe.</Alert>
          <Link className="btn" to="/login">Se connecter</Link>
        </> : <>
          <p className="muted">Essayez gratuitement pendant 30 jours. Aucune carte bancaire.</p>
          <div style={{ marginBottom: '.8rem' }}><label htmlFor="s-nom">Nom de l'école *</label><input id="s-nom" required {...LIBELLE(120)} value={v.nom} onChange={f('nom')} /></div>
          <div style={{ marginBottom: '.8rem' }}><label htmlFor="s-email">E-mail de la direction *</label><input id="s-email" type="email" required {...EMAIL} autoComplete="username" value={v.email} onChange={f('email')} /></div>
          <div style={{ marginBottom: '.8rem' }}><label htmlFor="s-pw">Mot de passe *</label><input id="s-pw" type="password" required {...MOT_DE_PASSE} autoComplete="new-password" value={v.password} onChange={f('password')} /><div className="muted small">8 caractères minimum, avec au moins une lettre et un chiffre.</div></div>
          <div style={{ marginBottom: '.8rem' }}><label><input type="checkbox" required checked={v.accepte} onChange={(e) => setV((s) => ({ ...s, accepte: e.target.checked }))} /> J'accepte les conditions d'utilisation et la politique de confidentialité. *</label></div>
          <Alert>{err}</Alert>
          <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'Création…' : "Créer mon école"}</button>
          <p className="small" style={{ marginTop: '1rem' }}>Déjà un compte ? <Link to="/login">Se connecter</Link></p>
        </>}
      </form>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, PasswordInput } from '../components/ui.jsx';
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
  if (ok) {
    return (
      <AuthShell title="Votre école est créée">
        <div className="success">
          <Alert kind="ok">Essai gratuit de 30 jours (jusqu'au {new Date(ok.essai_jusqu_au).toLocaleDateString('fr-FR')}). Connectez-vous avec votre e-mail et votre mot de passe.</Alert>
          <Link className="btn" to="/login">Se connecter<Icon name="arrow-right" size={16} /></Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell back title="Créer mon école" subtitle="Essayez gratuitement pendant 30 jours. Aucune carte bancaire.">
      <form onSubmit={submit}>
        <div className="form-field"><label htmlFor="s-nom">Nom de l'école <span className="req" aria-hidden="true">*</span></label><input id="s-nom" required {...LIBELLE(120)} value={v.nom} onChange={f('nom')} /></div>
        <div className="form-field"><label htmlFor="s-email">E-mail de la direction <span className="req" aria-hidden="true">*</span></label><input id="s-email" type="email" required {...EMAIL} autoComplete="username" value={v.email} onChange={f('email')} /></div>
        <div className="form-field"><label htmlFor="s-pw">Mot de passe <span className="req" aria-hidden="true">*</span></label><PasswordInput id="s-pw" required {...MOT_DE_PASSE} autoComplete="new-password" aria-describedby="s-pw-help" value={v.password} onChange={f('password')} /><div className="help" id="s-pw-help">8 caractères minimum, avec au moins une lettre et un chiffre.</div></div>
        <div className="form-field"><label className="check"><input type="checkbox" required checked={v.accepte} onChange={(e) => setV((s) => ({ ...s, accepte: e.target.checked }))} /><span>J'accepte les conditions d'utilisation et la politique de confidentialité. <span className="req" aria-hidden="true">*</span></span></label></div>
        <Alert>{err}</Alert>
        <button className="btn block" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Création…</> : "Créer mon école"}</button>
      </form>
      <div className="auth-links"><p>Déjà un compte ? <Link to="/login">Se connecter</Link></p></div>
    </AuthShell>
  );
}

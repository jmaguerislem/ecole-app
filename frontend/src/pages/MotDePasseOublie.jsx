import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, PasswordInput } from '../components/ui.jsx';
import { EMAIL, MOT_DE_PASSE } from '../rules.js';

// Mot de passe oublié : (1) on saisit son e-mail → le serveur envoie un code à usage unique ; (2) on saisit le code et un nouveau mot de passe.
// Le serveur répond toujours de la même façon (il ne révèle pas si l'adresse correspond à un compte).
export default function MotDePasseOublie() {
  const [params] = useSearchParams();
  const [etape, setEtape] = useState(1); // 1 = demande du code, 2 = saisie du code et du nouveau mot de passe, 3 = terminé
  const [f, setF] = useState({ email: params.get('email') || '', code: '', password: '', confirmation: '' });
  const [err, setErr] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const demander = async (e) => {
    e?.preventDefault(); setErr(''); setInfo(''); setBusy(true);
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { email: f.email.trim() } });
      setInfo(r.message); setEtape(2);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const valider = async (e) => {
    e.preventDefault(); setErr(''); setInfo('');
    if (f.password !== f.confirmation) return setErr('La confirmation ne correspond pas au nouveau mot de passe.');
    if (f.password.toLowerCase() === f.email.trim().toLowerCase()) return setErr("Le mot de passe ne doit pas être identique à l'e-mail.");
    setBusy(true);
    try {
      await api('/auth/set-password', { method: 'POST', body: { email: f.email.trim(), code: f.code.trim(), password: f.password, confirmation: f.confirmation } });
      setEtape(3);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (etape === 3) {
    return (
      <AuthShell title="Mot de passe enregistré">
        <div className="success">
          <Alert kind="ok">Votre nouveau mot de passe est enregistré. Vous pouvez maintenant vous connecter.</Alert>
          <Link className="btn" to="/login">Se connecter<Icon name="arrow-right" size={16} /></Link>
        </div>
      </AuthShell>
    );
  }
  if (etape === 1) {
    return (
      <AuthShell back title="Mot de passe oublié" subtitle="Saisissez votre adresse e-mail : nous vous envoyons un code pour choisir un nouveau mot de passe.">
        <form onSubmit={demander}>
          <div className="form-field"><label htmlFor="mo-email">Adresse e-mail <span className="req" aria-hidden="true">*</span></label><input id="mo-email" type="email" required {...EMAIL} autoComplete="username" value={f.email} onChange={set('email')} /></div>
          <Alert>{err}</Alert>
          <button className="btn block" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Envoi…</> : <><Icon name="send" size={16} />Recevoir un code</>}</button>
        </form>
        <div className="auth-links">
          <p>J'ai déjà un code : <button type="button" className="linklike" onClick={() => { setErr(''); setEtape(2); }}>le saisir</button></p>
          <p><Link to="/login">Retour à la connexion</Link></p>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell back title="Nouveau mot de passe" subtitle="Saisissez le code reçu par e-mail (valable 72 h, à usage unique) puis choisissez votre mot de passe.">
      <form onSubmit={valider}>
        <Alert kind="ok">{info}</Alert>
        <div className="form-field"><label htmlFor="mo-email2">Adresse e-mail <span className="req" aria-hidden="true">*</span></label><input id="mo-email2" type="email" required {...EMAIL} autoComplete="username" value={f.email} onChange={set('email')} /></div>
        <div className="form-field"><label htmlFor="mo-code">Code reçu par e-mail <span className="req" aria-hidden="true">*</span></label><input id="mo-code" required minLength={10} maxLength={20} pattern="[A-Za-z0-9\- ]{10,20}" title="Code à 10 caractères, par exemple ABCDE-23456" autoComplete="one-time-code" autoCapitalize="characters" spellCheck="false" value={f.code} onChange={set('code')} /></div>
        <div className="form-field"><label htmlFor="mo-pw">Nouveau mot de passe <span className="req" aria-hidden="true">*</span></label><PasswordInput id="mo-pw" required {...MOT_DE_PASSE} autoComplete="new-password" aria-describedby="mo-pw-help" value={f.password} onChange={set('password')} /><div className="help" id="mo-pw-help">8 caractères minimum, avec au moins une lettre et un chiffre.</div></div>
        <div className="form-field"><label htmlFor="mo-conf">Confirmer le mot de passe <span className="req" aria-hidden="true">*</span></label><PasswordInput id="mo-conf" required maxLength={72} autoComplete="new-password" value={f.confirmation} onChange={set('confirmation')} /></div>
        <Alert>{err}</Alert>
        <button className="btn block" disabled={busy}>{busy ? 'Enregistrement…' : <><Icon name="check" size={16} />Enregistrer le mot de passe</>}</button>
      </form>
      <div className="auth-links">
        <p>Pas reçu de code ? <button type="button" className="linklike" disabled={busy || !f.email} onClick={demander}>Renvoyer un code</button></p>
        <p><Link to="/login">Retour à la connexion</Link></p>
      </div>
    </AuthShell>
  );
}

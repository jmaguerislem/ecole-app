import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';
import { Alert } from '../components/ui.jsx';
import { EMAIL } from '../rules.js';

// Confirmation de l'adresse e-mail d'une école inscrite en libre-service : code à 10 caractères reçu dans la boîte de réception.
export default function VerifierEmail() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ email: params.get('email') || '', code: '' });
  const [err, setErr] = useState(''); const [info, setInfo] = useState(params.get('envoye') === '0' ? "Le code n'a pas pu être envoyé automatiquement : utilisez « Renvoyer un code »." : params.get('email') ? 'Un code vient de vous être envoyé par e-mail.' : '');
  const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const valider = async (e) => {
    e.preventDefault(); setErr(''); setInfo(''); setBusy(true);
    try { await api('/public/verify-email', { method: 'POST', body: { email: f.email.trim(), code: f.code.trim() } }); setOk(true); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const renvoyer = async () => {
    setErr(''); setInfo(''); setBusy(true);
    try { const r = await api('/public/resend-verification', { method: 'POST', body: { email: f.email.trim() } }); setInfo(r.message); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (ok) {
    return (
      <AuthShell title="Adresse e-mail confirmée">
        <div className="success">
          <Alert kind="ok">Merci ! Votre adresse est confirmée. Connectez-vous avec votre e-mail et votre mot de passe.</Alert>
          <Link className="btn" to="/login">Se connecter<Icon name="arrow-right" size={16} /></Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell back title="Confirmer mon adresse e-mail" subtitle="Saisissez le code à 10 caractères reçu par e-mail (valable 72 h) pour activer votre école.">
      <form onSubmit={valider}>
        <Alert kind="ok">{info}</Alert>
        <div className="form-field"><label htmlFor="ve-email">Adresse e-mail <span className="req" aria-hidden="true">*</span></label><input id="ve-email" type="email" required {...EMAIL} autoComplete="username" value={f.email} onChange={set('email')} /></div>
        <div className="form-field"><label htmlFor="ve-code">Code de vérification <span className="req" aria-hidden="true">*</span></label><input id="ve-code" required minLength={10} maxLength={20} pattern="[A-Za-z0-9\- ]{10,20}" title="Code à 10 caractères, par exemple ABCDE-23456" autoComplete="one-time-code" autoCapitalize="characters" spellCheck="false" value={f.code} onChange={set('code')} /></div>
        <Alert>{err}</Alert>
        <button className="btn block" disabled={busy}>{busy ? 'Vérification…' : <><Icon name="check" size={16} />Confirmer mon adresse</>}</button>
      </form>
      <div className="auth-links">
        <p>Pas reçu de code ? <button type="button" className="linklike" disabled={busy || !f.email} onClick={renvoyer}>Renvoyer un code</button> (pensez à vérifier les courriers indésirables)</p>
        <p><Link to="/login">Retour à la connexion</Link></p>
      </div>
    </AuthShell>
  );
}

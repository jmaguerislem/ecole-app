import { useState } from 'react';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/ui.jsx';
import { MOT_DE_PASSE } from '../rules.js';
import { isNative } from '../platform.js';
import { registerPush } from '../push.js';

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export default function Compte() {
  const { user, config } = useAuth();
  const [f, setF] = useState({ ancien: '', nouveau: '', confirmation: '' }); const [msg, setMsg] = useState(null);
  const change = async (e) => {
    e.preventDefault();
    if (f.nouveau !== f.confirmation) { setMsg({ k: 'err', t: 'La confirmation ne correspond pas au nouveau mot de passe.' }); return; }
    if (f.nouveau === f.ancien) { setMsg({ k: 'err', t: "Le nouveau mot de passe doit être différent de l'ancien." }); return; }
    try { await api('/auth/change-password', { method: 'POST', body: f }); setMsg({ k: 'ok', t: 'Mot de passe modifié.' }); setF({ ancien: '', nouveau: '', confirmation: '' }); } catch (x) { setMsg({ k: 'err', t: x.message }); }
  };
  const push = async () => {
    try {
      if (isNative) { await registerPush(); setMsg({ k: 'ok', t: 'Notifications push activées sur cet appareil.' }); return; }
      if (!config.vapidPublicKey) throw new Error("Les notifications push ne sont pas configurées sur ce serveur.");
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error("Ce navigateur ne prend pas en charge les notifications push.");
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Autorisation refusée.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(config.vapidPublicKey) });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      setMsg({ k: 'ok', t: 'Notifications push activées sur cet appareil.' });
    } catch (x) { setMsg({ k: 'err', t: x.message }); }
  };
  return (
    <div>
      <h1>Mon compte</h1>
      <div className="card"><p><b>{user.prenom} {user.nom}</b><br />{user.email}</p></div>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
      <form className="card" onSubmit={change}>
        <h2>Changer le mot de passe</h2>
        <div className="form-grid"><div><label htmlFor="o">Mot de passe actuel</label><input id="o" type="password" required maxLength={128} autoComplete="current-password" value={f.ancien} onChange={(e) => setF({ ...f, ancien: e.target.value })} /></div>
          <div><label htmlFor="n">Nouveau mot de passe (8 caractères min., avec une lettre et un chiffre)</label><input id="n" type="password" required {...MOT_DE_PASSE} autoComplete="new-password" value={f.nouveau} onChange={(e) => setF({ ...f, nouveau: e.target.value })} /></div>
          <div><label htmlFor="n2">Confirmer le nouveau mot de passe</label><input id="n2" type="password" required maxLength={128} autoComplete="new-password" aria-invalid={!!f.confirmation && f.confirmation !== f.nouveau} value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} /><div className={`help pw-match ${f.confirmation ? (f.confirmation === f.nouveau ? 'ok' : 'bad') : ''}`} role="status" aria-live="polite">{f.confirmation ? (f.confirmation === f.nouveau ? '✓ Les mots de passe correspondent.' : '✗ Les mots de passe ne correspondent pas.') : ''}</div></div></div>
        <button className="btn" style={{ marginTop: '.8rem' }}>Modifier</button>
      </form>
      <div className="card"><h2>Notifications & données personnelles</h2>
        <div className="row"><button className="btn sec" onClick={push}>Activer les notifications push</button>
          <button className="btn sec" onClick={() => download(`/rgpd/export/${user.id}`, 'mes-donnees.json')}>Exporter mes données (RGPD)</button></div>
        <p className="muted small">Pour demander l'effacement de votre compte, contactez l'administration.</p></div>
    </div>
  );
}

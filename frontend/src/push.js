// Notifications push natives (Android : Firebase Cloud Messaging ; iOS : APNs via FCM).
// Le jeton de l'appareil est enregistré dans la même table que les abonnements Web Push, avec le préfixe « fcm: ».
import { api } from './api.js';
import { isNative, platform } from './platform.js';

const KEY = 'push_token';
let listening = false;

export async function registerPush() {
  if (!isNative) return false;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') throw new Error('Autorisation de notification refusée (réglages du téléphone).');
  if (!listening) {
    listening = true;
    await PushNotifications.addListener('registration', async ({ value }) => {
      try { await api('/push/subscribe', { method: 'POST', body: { endpoint: `fcm:${value}`, keys: { platform } } }); localStorage.setItem(KEY, value); } catch { /* réessayé à la prochaine connexion */ }
    });
    await PushNotifications.addListener('registrationError', () => {});
    // Appui sur une notification → ouverture de la page concernée (géré par NativeBridge)
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const url = a.notification?.data?.url;
      if (url) window.dispatchEvent(new CustomEvent('native:navigate', { detail: url }));
    });
  }
  await PushNotifications.register();
  return true;
}

// À la déconnexion : l'appareil ne doit plus recevoir les notifications de ce compte
export async function unregisterPush() {
  const token = localStorage.getItem(KEY);
  if (!isNative || !token) return;
  try { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: `fcm:${token}` } }); } catch { /* ignore */ }
  localStorage.removeItem(KEY);
}

// ---------------- Navigateur (Web Push) ----------------
const WEB_KEY = 'web_push_endpoint';
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const webPushPossible = () => !isNative && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Abonne ce navigateur au compte connecté (demande l'autorisation si `demander`). Le serveur rattache l'abonnement à l'utilisateur
// courant : sur un navigateur partagé, c'est toujours le dernier compte connecté qui reçoit les notifications.
export async function activerPushWeb(vapidPublicKey, { demander = true } = {}) {
  if (!vapidPublicKey) throw new Error('Les notifications push ne sont pas configurées sur ce serveur.');
  if (!webPushPossible()) throw new Error('Ce navigateur ne prend pas en charge les notifications push.');
  if (Notification.permission === 'denied') throw new Error('Notifications bloquées : autorisez-les dans les réglages du navigateur.');
  if (Notification.permission !== 'granted') {
    if (!demander) return false;
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Autorisation refusée.');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidPublicKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  try { localStorage.setItem(WEB_KEY, sub.endpoint); } catch { /* ignore */ }
  return true;
}
// À la connexion : si l'utilisateur a déjà autorisé les notifications sur ce navigateur, on (ré)associe l'abonnement au compte, sans rien redemander
export async function syncPushWeb(vapidPublicKey) {
  if (!webPushPossible() || Notification.permission !== 'granted' || !vapidPublicKey) return false;
  try { return await activerPushWeb(vapidPublicKey, { demander: false }); } catch { return false; }
}
// À la déconnexion : ce navigateur ne doit plus recevoir les notifications de ce compte (appelé avec le jeton encore valide)
export async function desactiverPushWeb() {
  if (!webPushPossible()) return;
  // L'appel serveur part AVANT tout `await` : api() lit le jeton de façon synchrone, et le jeton est effacé juste après la déconnexion
  let endpoint = null; try { endpoint = localStorage.getItem(WEB_KEY); } catch { /* ignore */ }
  const retrait = endpoint ? api('/push/unsubscribe', { method: 'POST', body: { endpoint } }).catch(() => {}) : Promise.resolve();
  try { localStorage.removeItem(WEB_KEY); } catch { /* ignore */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe().catch(() => {});
  } catch { /* ignore */ }
  await retrait;
}

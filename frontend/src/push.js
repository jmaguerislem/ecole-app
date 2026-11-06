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

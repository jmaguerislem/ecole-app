// Service worker PWA : cache de l'enveloppe applicative + notifications push
const CACHE = 'ecole-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // l'API n'est jamais mise en cache
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});
// Adresse sûre : uniquement un chemin de l'application (jamais un lien externe ni « // »)
const cheminSur = (u) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? u : '/');
const fenetres = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });
self.addEventListener('push', (e) => {
  let d = { title: 'Notification', body: '' };
  try { if (e.data) d = e.data.json(); } catch { d = { title: 'Notification', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // `tag` : une même notification reçue deux fois (nouvelle tentative du serveur) ne s'affiche qu'une fois
    await self.registration.showNotification(d.title || 'Notification', { body: d.body || '', icon: '/icon-192.png', tag: d.tag || undefined, data: { url: cheminSur(d.url), id: d.id } });
    // Les onglets ouverts remettent aussitôt la cloche à jour
    for (const c of await fenetres()) c.postMessage({ type: 'notif:refresh' });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = cheminSur(e.notification.data && e.notification.data.url); const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const ouvert = (await fenetres()).find((c) => new URL(c.url).origin === self.location.origin);
    if (ouvert) { await ouvert.focus(); ouvert.postMessage({ type: 'notif:ouvrir', url, id }); } // on réutilise l'onglet ouvert au lieu d'en ouvrir un nouveau
    else await self.clients.openWindow(url);
  })());
});

// Teste public/sw.js en l'exécutant dans un faux contexte de service worker (pas de navigateur réel).
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import vm from 'node:vm';
const code = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function charge({ fenetres = [] } = {}) {
  const h = {}; const affichees = []; const ouvertes = [];
  const self = {
    location: { origin: 'https://ecole.test' }, addEventListener: (t, f) => { h[t] = f; }, skipWaiting() {}, clients: { claim() {}, matchAll: async () => fenetres, openWindow: async (u) => ouvertes.push(u) },
    registration: { showNotification: async (t, o) => affichees.push({ t, o }) },
  };
  vm.runInNewContext(code, { self, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => {}, match: async () => null }, fetch, URL, clients: self.clients, Promise, console });
  const evt = (extra) => { const p = []; return { ...extra, waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };
  return { h, affichees, ouvertes, evt };
}
const fen = (url) => { const c = { url, msgs: [], focused: 0, focus: async () => { c.focused++; }, postMessage: (m) => c.msgs.push(m) }; return c; };

test('push : notification affichée (titre, corps, tag, lien) et onglets ouverts prévenus pour la cloche', async () => {
  const w = fen('https://ecole.test/devoirs'); const s = charge({ fenetres: [w] });
  const e = s.evt({ data: { json: () => ({ title: 'Nouveau devoir', body: 'Fractions', url: '/devoirs', id: 7, tag: 'n7' }) } });
  s.h.push(e); await e.done();
  assert.equal(s.affichees[0].t, 'Nouveau devoir'); assert.equal(s.affichees[0].o.tag, 'n7'); assert.equal(s.affichees[0].o.data.url, '/devoirs');
  assert.equal(JSON.stringify(w.msgs), JSON.stringify([{ type: 'notif:refresh' }]));
});
test('push : charge illisible → notification générique, jamais d’exception', async () => {
  const s = charge(); const e = s.evt({ data: { json: () => { throw new Error('x'); }, text: () => 'brut' } });
  s.h.push(e); await e.done(); assert.equal(s.affichees[0].o.body, 'brut');
});
test('push : lien externe ou « // » neutralisé (jamais d’ouverture hors de l’application)', async () => {
  for (const u of ['https://evil.test/x', '//evil.test', 'javascript:alert(1)']) {
    const s = charge(); const e = s.evt({ data: { json: () => ({ title: 't', url: u }) } }); s.h.push(e); await e.done();
    assert.equal(s.affichees[0].o.data.url, '/', u);
  }
});
test('clic : réutilise l’onglet ouvert (focus + navigation interne) au lieu d’ouvrir une nouvelle fenêtre', async () => {
  const w = fen('https://ecole.test/'); const s = charge({ fenetres: [w] }); let ferme = 0;
  const e = s.evt({ notification: { close: () => ferme++, data: { url: '/messagerie/5', id: 5 } } }); s.h.notificationclick(e); await e.done();
  assert.equal(ferme, 1); assert.equal(w.focused, 1); assert.equal(JSON.stringify(w.msgs), JSON.stringify([{ type: 'notif:ouvrir', url: '/messagerie/5', id: 5 }])); assert.equal(s.ouvertes.length, 0);
});
test('clic : aucun onglet ouvert → ouvre la page concernée ; onglet d’une autre origine ignoré', async () => {
  const s = charge({ fenetres: [fen('https://autre.test/')] });
  const e = s.evt({ notification: { close() {}, data: { url: '/absences' } } }); s.h.notificationclick(e); await e.done();
  assert.equal(JSON.stringify(s.ouvertes), '["/absences"]');
});

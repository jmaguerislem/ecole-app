// Tests : notifications internes (cloche web / liste mobile), push navigateur (Web Push) et téléphone (FCM), e-mails.
// Un client « web » et un client « mobile » appellent les MÊMES routes (c'est le cas en production) ; on vérifie que
//  - chaque événement produit les mêmes notifications / push / e-mails quelle que soit la plateforme d'origine,
//  - chaque destinataire reçoit sur TOUS ses appareils (navigateur + téléphone), et seulement lui (rôles, école),
//  - rien n'est envoyé en double (nouvelle tentative, double clic, appel refait),
//  - l'état « lu » est partagé entre les deux plateformes.
// Les envois réels (Firebase, service Web Push) sont remplacés par des enregistreurs ; l'e-mail utilise la boîte mémoire.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');
const mailer = require('../src/services/mailer');
const notif = require('../src/services/notify');

const PW = 'Test@2026x1'; const stamp = Date.now().toString(36);
const CUR = config.anneeCourante;
let base; let server; let sup; const ids = []; const X = {}; const T = {};
const livraisons = []; // { canal: 'web' | 'fcm', cible, notif }
let panneFcm = null; // simule un jeton FCM périmé

// `client` identifie la plateforme d'origine (en-tête informatif) : le serveur doit se comporter à l'identique.
async function call(token, method, url, body, client = 'web') {
  const headers = { 'X-Client': client, 'User-Agent': client === 'mobile' ? 'Dart/3.9 (dart:io)' : 'Mozilla/5.0 (Web)' };
  let payload;
  if (body instanceof FormData) payload = body; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: payload });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const must = async (token, method, url, body, client) => { const r = await call(token, method, url, body, client); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const login = async (email) => { const r = await must(null, 'POST', '/api/auth/login', { email, password: PW }); if (r.user.must_change_password) await db.qa('UPDATE users SET must_change_password=FALSE WHERE id=$1', [r.user.id]); return r.token; };
const ins = async (schoolId, table, o) => {
  const k = Object.keys(o);
  const r = await db.qa(`INSERT INTO ${table}(${k.join(',')},school_id) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')},$${k.length + 1}) RETURNING *`, [...k.map((c) => o[c]), schoolId]);
  return r.rows[0].id;
};
const iso = (d) => d.toISOString().slice(0, 10);
const ouvre = (joursAvant) => { const d = new Date(Date.now() - joursAvant * 86400000); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return iso(d); };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const form = (champs) => { const fd = new FormData(); for (const [k, v] of Object.entries(champs)) fd.append(k, v); return fd; };
// Attend qu'une condition asynchrone soit vraie (les notifications d'annonces/devoirs/appels partent après la réponse HTTP)
async function jusqua(fn, msg, delai = 4000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > delai) assert.fail(`Délai dépassé : ${msg}`); await attendre(50); } }

// Instantané de ce qu'un utilisateur a reçu, plateforme par plateforme
async function recu(userId) {
  const n = (await db.qa('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id', [userId])).rows;
  return {
    internes: n,
    nb: n.length,
    web: livraisons.filter((l) => l.canal === 'web' && l.userId === userId).length,
    fcm: livraisons.filter((l) => l.canal === 'fcm' && l.userId === userId).length,
    mails: mailer.sent.filter((m) => m.to === X.mailDe[userId]).length,
  };
}
const delta = (apres, avant) => ({ nb: apres.nb - avant.nb, web: apres.web - avant.web, fcm: apres.fcm - avant.fcm, mails: apres.mails - avant.mails });
// notify() appelé hors requête HTTP (comme une tâche de fond) : il faut le contexte de l'école
const notifier = (...a) => db.runWith({ schoolId: T.a.id, schoolNom: `Notifa ${stamp}` }, () => notif.notify(...a));
const AUCUN = { nb: 0, web: 0, fcm: 0, mails: 0 };
const UN_PARTOUT = { nb: 1, web: 1, fcm: 1, mails: 1 };

test.before(async () => {
  await migrate();
  process.env.MAIL_TRANSPORT = 'memory';
  // Services push « configurés » pour la durée du fichier ; les envois sont enregistrés au lieu de partir sur le réseau
  config.firebase = config.firebase || { project_id: 'test' }; config.vapid = config.vapid || { subject: 'mailto:t@t.tn', pub: 'x', priv: 'y' };
  notif.envoi.fcm = async (token, n) => { if (panneFcm) { const e = new Error('Requested entity was not found.'); e.code = panneFcm; throw e; } livraisons.push({ canal: 'fcm', cible: token, notif: n, userId: X.parToken?.[`fcm:${token}`] }); };
  notif.envoi.web = async (sub, n) => { livraisons.push({ canal: 'web', cible: sub.endpoint, notif: n, userId: X.parToken?.[sub.endpoint] }); };
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const hash = await bcrypt.hash(PW, 4);
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@notif.test`, hash]);
  sup = await login(`sa-${stamp}@notif.test`);
  for (const k of ['a', 'b']) {
    const r = await must(sup, 'POST', '/api/saas/schools', { nom: `Notif${k} ${stamp}`, ville: `V${k}`, status: 'active', plan: 'premium', admin: { email: `dir-${k}-${stamp}@notif.test`, password: PW } });
    ids.push(r.id); T[k] = { id: r.id };
  }
  const sA = T.a.id; const sB = T.b.id;
  T.a.admin = await login(`dir-a-${stamp}@notif.test`); T.b.admin = await login(`dir-b-${stamp}@notif.test`);
  X.adminA = (await db.qa('SELECT id FROM users WHERE lower(email)=lower($1)', [`dir-a-${stamp}@notif.test`])).rows[0].id;
  X.adminB = (await db.qa('SELECT id FROM users WHERE lower(email)=lower($1)', [`dir-b-${stamp}@notif.test`])).rows[0].id;
  const user = (s, role, nom, extra = {}) => ins(s, 'users', { email: `${nom}-${stamp}@notif.test`.toLowerCase(), password_hash: hash, role, nom, prenom: 'Bi', ...extra });
  X.compta = await user(sA, 'comptable', 'compta');
  X.ens1 = await user(sA, 'enseignant', 'ens1'); X.ens2 = await user(sA, 'enseignant', 'ens2');
  X.p1 = await user(sA, 'parent', 'p1'); X.p2 = await user(sA, 'parent', 'p2'); X.p3 = await user(sA, 'parent', 'p3', { actif: false });
  X.el1 = await user(sA, 'eleve', 'el1');
  X.pB = await user(sB, 'parent', 'pb');
  X.mailDe = {};
  for (const [id, nom] of [[X.adminA, 'dir-a'], [X.adminB, 'dir-b'], [X.compta, 'compta'], [X.ens1, 'ens1'], [X.ens2, 'ens2'], [X.p1, 'p1'], [X.p2, 'p2'], [X.p3, 'p3'], [X.el1, 'el1'], [X.pB, 'pb']]) X.mailDe[id] = `${nom}-${stamp}@notif.test`;
  X.c1 = await ins(sA, 'classes', { niveau: '1ère année', section: 'A', capacite: 25, annee_scolaire: CUR, titulaire_id: X.ens1 });
  X.c2 = await ins(sA, 'classes', { niveau: '2ème année', section: 'A', capacite: 25, annee_scolaire: CUR, titulaire_id: X.ens2 });
  X.e1 = await ins(sA, 'eleves', { nom: 'Un', prenom: 'Eleve', classe_id: X.c1, annee_entree: CUR, statut: 'actif', user_id: X.el1 });
  X.e3 = await ins(sA, 'eleves', { nom: 'Trois', prenom: 'Eleve', classe_id: X.c2, annee_entree: CUR, statut: 'actif' });
  await ins(sA, 'eleve_parents', { eleve_id: X.e1, parent_id: X.p1, lien: 'mere' });
  await ins(sA, 'eleve_parents', { eleve_id: X.e1, parent_id: X.p3, lien: 'pere' }); // compte désactivé : ne doit rien recevoir
  await ins(sA, 'eleve_parents', { eleve_id: X.e3, parent_id: X.p2, lien: 'pere' });
  for (const k of ['compta', 'ens1', 'ens2', 'p1', 'p2', 'el1']) T[k] = await login(`${k}-${stamp}@notif.test`);
  X.parToken = {};
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@notif.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// Enregistre un navigateur (Web Push) et/ou un téléphone (FCM) pour un utilisateur, comme le font le site et l'application
async function abonne(userKey, userId, { web = false, mobile = false } = {}) {
  if (web) { const ep = `https://push.example.test/${stamp}/${userKey}`; X.parToken[ep] = userId; await must(T[userKey], 'POST', '/api/push/subscribe', { endpoint: ep, keys: { p256dh: 'k', auth: 'a' } }, 'web'); }
  if (mobile) { const tok = `tok-${userKey}-${stamp}`; X.parToken[`fcm:${tok}`] = userId; await must(T[userKey], 'POST', '/api/push/subscribe', { endpoint: `fcm:${tok}`, keys: { platform: 'android', device: `dev-${userKey}-${stamp}` } }, 'mobile'); }
}

// ======================= Abonnements et appareils =======================
test('abonnements : navigateur ET téléphone pour le même compte ; un appareil = un seul jeton', async () => {
  await abonne('p1', X.p1, { web: true, mobile: true });
  await abonne('p2', X.p2, { mobile: true });
  await abonne('ens1', X.ens1, { mobile: true });
  await abonne('compta', X.compta, { web: true });
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM push_subscriptions WHERE user_id=$1', [X.p1])).rows[0].n, 2, 'un navigateur + un téléphone');
  // Le téléphone renvoie un nouveau jeton (rotation FCM / réinstallation) : l'ancien disparaît, pas de notification en double
  X.parToken[`fcm:tok2-p1-${stamp}`] = X.p1;
  await must(T.p1, 'POST', '/api/push/subscribe', { endpoint: `fcm:tok2-p1-${stamp}`, keys: { platform: 'android', device: `dev-p1-${stamp}` } }, 'mobile');
  const subs = (await db.qa('SELECT endpoint FROM push_subscriptions WHERE user_id=$1 ORDER BY endpoint', [X.p1])).rows.map((r) => r.endpoint);
  assert.equal(subs.length, 2); assert.ok(subs.includes(`fcm:tok2-p1-${stamp}`) && !subs.includes(`fcm:tok-p1-${stamp}`), 'ancien jeton remplacé');
  // Valeurs invalides refusées
  assert.equal((await call(T.p1, 'POST', '/api/push/subscribe', { endpoint: 'http://non-https.example', keys: {} }, 'web')).status, 400);
  assert.equal((await call(T.p1, 'POST', '/api/push/subscribe', { endpoint: 'fcm:abcdefghij' }, 'mobile')).status, 400, 'keys obligatoire');
  assert.equal((await call(null, 'POST', '/api/push/subscribe', { endpoint: 'fcm:abcdefghij', keys: {} }, 'mobile')).status, 401);
});

test('abonnement : un téléphone prêté à un autre compte ne reçoit plus les notifications du précédent', async () => {
  const tok = `tok-partage-${stamp}`;
  await must(T.p2, 'POST', '/api/push/subscribe', { endpoint: `fcm:${tok}`, keys: { platform: 'android' } }, 'mobile');
  await must(T.ens2, 'POST', '/api/push/subscribe', { endpoint: `fcm:${tok}`, keys: { platform: 'android' } }, 'mobile');
  const r = (await db.qa('SELECT user_id FROM push_subscriptions WHERE endpoint=$1', [`fcm:${tok}`])).rows;
  assert.deepEqual(r.map((x) => x.user_id), [X.ens2], 'le jeton appartient au dernier compte connecté');
  await must(T.ens2, 'POST', '/api/push/unsubscribe', { endpoint: `fcm:${tok}` }, 'mobile');
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM push_subscriptions WHERE endpoint=$1', [`fcm:${tok}`])).rows[0].n, 0, 'retiré à la déconnexion');
  await db.qa('DELETE FROM push_subscriptions WHERE user_id=$1', [X.p2]); // retire aussi l'abonnement de p2 posé par ce test
  await abonne('p2', X.p2, { mobile: true });
});

// ======================= Même règles quelle que soit la plateforme d'origine =======================
test('message : même résultat qu’il soit envoyé depuis le site ou depuis l’application (interne + push web + push FCM + e-mail)', async () => {
  for (const client of ['web', 'mobile']) {
    const avant = await recu(X.p1);
    const r = await must(T.ens1, 'POST', '/api/messages', { destinataires: JSON.stringify([X.p1]), objet: `Réunion ${client}`, corps: `Bonjour depuis ${client}` }, client);
    assert.equal(r.statut, 'envoye');
    const apres = await recu(X.p1);
    assert.deepEqual(delta(apres, avant), UN_PARTOUT, `envoi depuis ${client}`);
    const n = apres.internes.at(-1);
    assert.equal(n.type, 'message'); assert.equal(n.lien, `/messagerie/${r.id}`); assert.equal(n.lu, false);
  }
  // contenu du push : identique sur les deux canaux, avec de quoi ouvrir la bonne page et marquer comme lu
  const w = livraisons.filter((l) => l.canal === 'web' && l.userId === X.p1).at(-1); const f = livraisons.filter((l) => l.canal === 'fcm' && l.userId === X.p1).at(-1);
  assert.equal(w.notif.titre, f.notif.titre); assert.equal(w.notif.lien, f.notif.lien); assert.equal(w.notif.id, f.notif.id); assert.ok(w.notif.id > 0);
  assert.equal(f.cible, `tok2-p1-${stamp}`, 'le jeton courant (pas l’ancien)');
  const m = mailer.sent.filter((x) => x.to === X.mailDe[X.p1]).at(-1);
  assert.ok(m.subject.includes('Nouveau message') && m.text.includes('/messagerie/'), 'e-mail avec lien vers le message');
});

test('absence : parents notifiés partout + e-mail, élève notifié sans e-mail ; identique depuis le site (saisie) et l’application (appel)', async () => {
  // Site : la direction saisit l'absence
  let avant = await recu(X.p1); let avantEl = await recu(X.el1);
  await must(T.a.admin, 'POST', '/api/absences', { eleve_id: X.e1, date_absence: ouvre(2), periode: 'matin', motif: 'Rhume' }, 'web');
  await jusqua(async () => (await recu(X.p1)).nb > avant.nb, 'notification du parent (saisie)');
  await attendre(150);
  assert.deepEqual(delta(await recu(X.p1), avant), UN_PARTOUT, 'saisie depuis le site');
  const el = delta(await recu(X.el1), avantEl); assert.equal(el.nb, 1, 'l’élève est notifié'); assert.equal(el.mails, 0, 'jamais d’e-mail à l’élève');
  // Application : l'enseignant fait l'appel
  avant = await recu(X.p1);
  await must(T.ens1, 'PUT', '/api/absences/appel', { classe_id: X.c1, date_absence: ouvre(3), absents: [{ eleve_id: X.e1, periode: 'journee' }] }, 'mobile');
  await jusqua(async () => (await recu(X.p1)).nb > avant.nb, 'notification du parent (appel)');
  await attendre(150);
  assert.deepEqual(delta(await recu(X.p1), avant), UN_PARTOUT, 'appel depuis l’application');
  // Personne d'autre
  for (const [k, id] of [['p2', X.p2], ['ens2', X.ens2], ['compta', X.compta]]) assert.equal((await recu(id)).internes.filter((n) => n.type === 'absence').length, 0, `${k} ne reçoit pas l’absence de l’élève d’un autre`);
  assert.equal((await recu(X.p3)).nb, 0, 'parent au compte désactivé : rien');
  assert.equal((await recu(X.pB)).nb, 0, 'autre école : rien');
});

// ======================= Aucun doublon =======================
test('doublon : même message renvoyé (nouvelle tentative réseau, double clic simultané) → un seul message, une seule notification', async () => {
  const corps = { destinataires: JSON.stringify([X.p1]), objet: 'Sortie scolaire', corps: 'Jeudi à 9h' };
  const avant = await recu(X.p1);
  // Deux requêtes simultanées (double clic) depuis le site + une nouvelle tentative depuis l'application
  const [a, b] = await Promise.all([call(T.ens1, 'POST', '/api/messages', corps, 'web'), call(T.ens1, 'POST', '/api/messages', corps, 'web')]);
  const c = await call(T.ens1, 'POST', '/api/messages', corps, 'mobile');
  assert.ok([a, b, c].every((r) => r.status < 300));
  assert.equal(new Set([a.data.id, b.data.id, c.data.id]).size, 1, 'un seul message créé');
  assert.equal((await db.qa("SELECT COUNT(*)::int n FROM messages WHERE objet='Sortie scolaire' AND sender_id=$1", [X.ens1])).rows[0].n, 1);
  assert.deepEqual(delta(await recu(X.p1), avant), UN_PARTOUT, 'une seule notification, un seul push par appareil, un seul e-mail');
  // Un message différent, lui, est bien envoyé
  const d = await call(T.ens1, 'POST', '/api/messages', { ...corps, corps: 'Jeudi à 10h' }, 'mobile'); assert.equal(d.status, 201);
});

test('doublon : appel refait (absent → présent → absent) ou enregistré depuis les deux plateformes → parents notifiés une seule fois', async () => {
  const date = ouvre(4); const avant = await recu(X.p1);
  const appel = (absents, client, tok = T.ens1) => must(tok, 'PUT', '/api/absences/appel', { classe_id: X.c1, date_absence: date, absents }, client);
  await appel([{ eleve_id: X.e1, periode: 'matin' }], 'mobile');
  await jusqua(async () => (await recu(X.p1)).nb > avant.nb, 'première notification');
  await appel([], 'web');                                                  // correction : finalement présent
  await appel([{ eleve_id: X.e1, periode: 'matin' }], 'mobile');            // … puis de nouveau absent
  await appel([{ eleve_id: X.e1, periode: 'matin' }], 'web');               // renvoi identique depuis le site
  await attendre(400);
  assert.deepEqual(delta(await recu(X.p1), avant), UN_PARTOUT, 'un seul événement = une seule notification');
  // Un autre jour est un nouvel événement : notifié
  await must(T.ens1, 'PUT', '/api/absences/appel', { classe_id: X.c1, date_absence: ouvre(6), absents: [{ eleve_id: X.e1, periode: 'matin' }] }, 'web');
  await jusqua(async () => (await recu(X.p1)).nb === avant.nb + 2, 'nouvel événement notifié');
});

test('doublon : notify() est idempotent pour une même clé d’événement (base : contrainte unique)', async () => {
  const avant = await recu(X.p2);
  const n = { type: 'devoir', titre: 'Idempotence', corps: 'x', lien: '/devoirs', cle: `test:idem:${stamp}` };
  const r1 = await notifier([X.p2, X.p2], n); const r2 = await notifier([X.p2], n);
  assert.equal(r1.internes, 1, 'dédoublonné dans l’appel'); assert.equal(r2.doublons, 1); assert.equal(r2.internes, 0);
  assert.equal(delta(await recu(X.p2), avant).nb, 1);
});

// ======================= Rôles, autorisations, écoles =======================
test('annonces : audience respectée (parents / enseignants / tous), comptes désactivés et autres écoles exclus ; e-mail + push partout', async () => {
  const snap = async () => Object.fromEntries(await Promise.all([['p1', X.p1], ['p2', X.p2], ['p3', X.p3], ['ens1', X.ens1], ['ens2', X.ens2], ['compta', X.compta], ['el1', X.el1], ['pB', X.pB]].map(async ([k, id]) => [k, await recu(id)])));
  let avant = await snap();
  await must(T.a.admin, 'POST', '/api/annonces', { titre: 'Kermesse', corps: 'Samedi prochain', audience: 'parents' }, 'web');
  await jusqua(async () => (await recu(X.p2)).nb > avant.p2.nb, 'annonce parents');
  await attendre(200);
  let apres = await snap();
  assert.deepEqual(delta(apres.p1, avant.p1), UN_PARTOUT); assert.deepEqual(delta(apres.p2, avant.p2), { nb: 1, web: 0, fcm: 1, mails: 1 }, 'p2 n’a qu’un téléphone');
  for (const k of ['p3', 'ens1', 'ens2', 'compta', 'el1', 'pB']) assert.deepEqual(delta(apres[k], avant[k]), AUCUN, `${k} hors audience « parents » / compte inactif / autre école`);
  avant = apres;
  await must(T.a.admin, 'POST', '/api/annonces', { titre: 'Conseil des maîtres', corps: 'Vendredi 15h', audience: 'enseignants' }, 'mobile');
  await jusqua(async () => (await recu(X.ens2)).nb > avant.ens2.nb, 'annonce enseignants');
  await attendre(200);
  apres = await snap();
  assert.deepEqual(delta(apres.ens1, avant.ens1), { nb: 1, web: 0, fcm: 1, mails: 1 });
  assert.equal(delta(apres.ens2, avant.ens2).nb, 1);
  for (const k of ['p1', 'p2', 'p3', 'compta', 'el1', 'pB']) assert.deepEqual(delta(apres[k], avant[k]), AUCUN, `${k} hors audience « enseignants »`);
  // L'auteur ne se notifie pas lui-même
  assert.equal((await recu(X.adminA)).internes.filter((n) => n.type === 'annonce').length, 0);
});

test('devoir : seuls l’élève et les parents de LA classe sont notifiés, sans e-mail (politique) ; correction idem', async () => {
  const matiere = await must(T.a.admin, 'POST', '/api/matieres', { nom: `Maths ${stamp}`, coefficient: 2 }, 'web');
  const avP1 = await recu(X.p1); const avEl = await recu(X.el1); const avP2 = await recu(X.p2);
  const dv = await must(T.ens1, 'POST', '/api/devoirs', form({ titre: 'Fractions', matiere_id: matiere.id, classe_id: X.c1, date_remise: new Date(Date.now() + 5 * 864e5).toISOString() }), 'mobile');
  await jusqua(async () => (await recu(X.p1)).nb > avP1.nb, 'devoir');
  await attendre(150);
  assert.deepEqual(delta(await recu(X.p1), avP1), { nb: 1, web: 1, fcm: 1, mails: 0 }, 'parent : interne + push partout, pas d’e-mail');
  assert.equal(delta(await recu(X.el1), avEl).nb, 1, 'l’élève de la classe');
  assert.deepEqual(delta(await recu(X.p2), avP2), AUCUN, 'parent d’une autre classe');
  assert.equal((await recu(X.p3)).nb, 0);
  assert.ok(dv.id > 0);
});

test('réclamation : nouvelle → direction (e-mail + push) ; traitée → le parent concerné seulement ; pré-inscription → direction et secrétariat', async () => {
  const avAdmin = await recu(X.adminA); const avCompta = await recu(X.compta); const avP1 = await recu(X.p1); const avP2 = await recu(X.p2);
  const rec = await must(T.p1, 'POST', '/api/reclamations', { eleve_id: X.e1, categorie: 'pedagogique', objet: 'Cahier perdu', description: 'Le cahier de mon enfant a disparu en classe.' }, 'mobile');
  await jusqua(async () => (await recu(X.adminA)).nb > avAdmin.nb, 'réclamation → direction');
  assert.equal((await recu(X.adminA)).mails - avAdmin.mails, 1, 'e-mail à la direction'); assert.equal((await recu(X.compta)).nb - avCompta.nb, 0, 'pas au secrétariat');
  assert.equal((await recu(X.p2)).nb - avP2.nb, 0);
  await must(T.a.admin, 'PUT', `/api/reclamations/${rec.id}`, { statut: 'resolue', reponse: 'Cahier retrouvé' }, 'web');
  await jusqua(async () => (await recu(X.p1)).nb > avP1.nb, 'réclamation traitée → parent');
  assert.deepEqual(delta(await recu(X.p1), avP1), UN_PARTOUT);
  assert.equal((await recu(X.p2)).nb - avP2.nb, 0, 'un autre parent ne reçoit rien');
  // Pré-inscription publique (formulaire du site) → direction + secrétariat
  const slug = (await db.qa('SELECT slug FROM schools WHERE id=$1', [T.a.id])).rows[0].slug;
  const avA = await recu(X.adminA); const avC = await recu(X.compta);
  const pre = await call(null, 'POST', `/api/public/${slug}/preinscriptions`, { eleve_nom: 'Nouveau', eleve_prenom: 'Elève', date_naissance: '2019-03-04', parent_nom: 'Parent', parent_prenom: 'Neuf', parent_email: `neuf-${stamp}@parents.test`, consentement_rgpd: true }, 'web');
  assert.equal(pre.status, 201, JSON.stringify(pre.data));
  assert.equal((await recu(X.adminA)).nb - avA.nb, 1); const apC = await recu(X.compta);
  assert.deepEqual(delta(apC, avC), { nb: 1, web: 1, fcm: 0, mails: 1 }, 'secrétariat : interne + push navigateur + e-mail');
  assert.equal((await recu(X.pB)).nb, 0, 'aucune fuite vers l’autre école');
});

test('paiement et relance : message automatique au parent → interne, push partout, e-mail (même règle que tout message)', async () => {
  const avant = await recu(X.p1);
  const p = await must(T.compta, 'POST', '/api/paiements', { eleve_id: X.e1, montant: 50, mode: 'especes' }, 'mobile');
  assert.ok(p.id);
  await jusqua(async () => (await recu(X.p1)).nb > avant.nb, 'paiement → parent');
  assert.deepEqual(delta(await recu(X.p1), avant), UN_PARTOUT);
  const dernier = (await recu(X.p1)).internes.at(-1); assert.equal(dernier.type, 'message'); assert.ok(dernier.titre.includes('Paiement reçu'));
  assert.equal((await recu(X.p2)).internes.filter((n) => n.titre.includes('Paiement')).length, 0);
});

// ======================= Lecture synchronisée web ↔ mobile =======================
test('synchronisation : « lu » sur le site est vu par l’application (et inversement) ; chacun ne touche qu’à ses notifications', async () => {
  const web = (await must(T.p1, 'GET', '/api/notifications', null, 'web')); const mob = (await must(T.p1, 'GET', '/api/notifications', null, 'mobile'));
  assert.deepEqual(web.map((n) => n.id), mob.map((n) => n.id), 'même liste sur les deux plateformes');
  const c0 = await must(T.p1, 'GET', '/api/notifications/count', null, 'mobile');
  assert.equal(typeof c0.non_lues, 'number', 'le compteur est un entier (cloche web, pastille mobile)');
  assert.equal(c0.non_lues, web.filter((n) => !n.lu).length);
  assert.ok(c0.non_lues >= 3);
  // Lu depuis le site → l'application le voit
  await must(T.p1, 'POST', `/api/notifications/${web[0].id}/lu`, {}, 'web');
  assert.equal((await must(T.p1, 'GET', '/api/notifications/count', null, 'mobile')).non_lues, c0.non_lues - 1);
  // Tout lu depuis l'application → le site le voit
  await must(T.p1, 'POST', '/api/notifications/lu-tout', {}, 'mobile');
  assert.equal((await must(T.p1, 'GET', '/api/notifications/count', null, 'web')).non_lues, 0);
  assert.ok((await must(T.p1, 'GET', '/api/notifications', null, 'web')).every((n) => n.lu));
  // Isolation : p2 ne peut pas marquer / lire les notifications de p1
  const autre = (await recu(X.p1)).internes[0].id;
  await must(T.p2, 'POST', `/api/notifications/${autre}/lu`, {}, 'web');
  assert.ok((await must(T.p2, 'GET', '/api/notifications', null, 'mobile')).every((n) => n.id !== autre));
  assert.equal((await call(null, 'GET', '/api/notifications/count', null, 'mobile')).status, 401);
});

// ======================= Résilience =======================
test('résilience : jeton FCM périmé supprimé sans empêcher les autres appareils ; panne SMTP n’empêche ni l’interne ni le push', async () => {
  const avant = await recu(X.p1);
  panneFcm = 'messaging/registration-token-not-registered';
  await must(T.ens1, 'POST', '/api/messages', { destinataires: JSON.stringify([X.p1]), objet: 'Jeton périmé', corps: 'test panne FCM' }, 'web');
  panneFcm = null;
  const a1 = await recu(X.p1);
  assert.deepEqual(delta(a1, avant), { nb: 1, web: 1, fcm: 0, mails: 1 }, 'le navigateur et l’e-mail partent malgré la panne FCM');
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM push_subscriptions WHERE user_id=$1 AND endpoint LIKE $2', [X.p1, 'fcm:%'])).rows[0].n, 0, 'jeton périmé retiré de la base');
  assert.ok((await db.qa("SELECT 1 FROM notification_log WHERE user_id=$1 AND canal='push' AND statut='echec' AND sujet LIKE 'Nouveau message%'", [X.p1])).rowCount >= 1, 'échec journalisé');
  await abonne('p1', X.p1, { mobile: true }); // le téléphone se réabonne à sa prochaine ouverture
  mailer.simulerEchec('SMTP indisponible');
  const av2 = await recu(X.p1);
  await must(T.ens1, 'POST', '/api/messages', { destinataires: JSON.stringify([X.p1]), objet: 'Panne SMTP', corps: 'test panne SMTP' }, 'mobile');
  mailer.simulerEchec(null);
  assert.deepEqual(delta(await recu(X.p1), av2), { nb: 1, web: 1, fcm: 1, mails: 0 }, 'interne + push partout malgré l’e-mail en échec');
  const j = (await db.qa("SELECT statut, erreur FROM notification_log WHERE user_id=$1 AND canal='email' AND statut='echec' ORDER BY id DESC LIMIT 1", [X.p1])).rows;
  assert.deepEqual(j.map((x) => x.statut), ['echec']); assert.ok(j[0].erreur.includes('SMTP indisponible'));
});

test('configuration absente : FCM / SMTP non configurés → l’événement réussit et l’envoi ignoré est journalisé (au lieu d’un silence)', async () => {
  const fb = config.firebase; config.firebase = null;
  await abonne('p1', X.p1, { mobile: true });
  const avant = await recu(X.p1);
  const r = await notifier([X.p1], { type: 'message', titre: 'Sans FCM', corps: 'x', lien: '/messagerie' });
  config.firebase = fb;
  assert.equal(r.internes, 1); assert.equal(delta(await recu(X.p1), avant).fcm, 0);
  const j = (await db.qa("SELECT statut, erreur FROM notification_log WHERE user_id=$1 AND canal='push' AND sujet='Sans FCM'", [X.p1])).rows;
  assert.ok(j.some((x) => x.statut === 'ignore' && /FCM/.test(x.erreur)), 'push ignoré journalisé');
});

test('politique d’e-mail : une seule table pour tous les types, surchargeable ; type inconnu = pas d’e-mail', async () => {
  assert.deepEqual(Object.keys(notif.POLITIQUE_EMAIL).sort(), ['absence', 'annonce', 'correction', 'depot', 'devoir', 'message', 'note', 'preinscription', 'reclamation', 'remplacement', 'retard']);
  const avant = await recu(X.p2);
  await notifier([X.p2], { type: 'inconnu', titre: 'Type inconnu', corps: 'x', lien: '/' });
  await notifier([X.p2], { type: 'message', titre: 'Forcé sans e-mail', corps: 'x', lien: '/' }, { email: false });
  await notifier([X.p2], { type: 'devoir', titre: 'Forcé avec e-mail', corps: 'x', lien: '/' }, { email: true });
  assert.equal((await recu(X.p2)).mails - avant.mails, 1, 'seul l’appel forcé envoie un e-mail');
});

test('remplacement et note : enseignant remplaçant notifié (e-mail), note publiée → élève et parents seulement', async () => {
  const avE2 = await recu(X.ens2); const avE1 = await recu(X.ens1);
  const d = ouvre(1);
  await must(T.a.admin, 'POST', '/api/absences-enseignants', { enseignant_id: X.ens1, date_absence: d, periode: 'journee', motif: 'Maladie', justifiee: true, remplacant_id: X.ens2 }, 'web');
  await jusqua(async () => (await recu(X.ens2)).nb > avE2.nb, 'remplaçant notifié');
  assert.deepEqual(delta(await recu(X.ens2), avE2), { nb: 1, web: 0, fcm: 0, mails: 1 }, 'remplaçant : interne + e-mail (pas d’appareil enregistré)');
  assert.equal((await recu(X.ens1)).nb - avE1.nb, 0, 'l’absent n’est pas notifié de son propre remplacement');
});

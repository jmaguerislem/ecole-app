// Tests des corrections issues de l'audit : saisies invalides (400 et non 500), uploads, secret JWT, consentement RGPD, export CSV,
// abonnements push, mot de passe oublié, vérification d'e-mail à l'inscription, e-mails de notification (transport unique).
// Les e-mails sont capturés en mémoire (MAIL_TRANSPORT=memory) : aucun envoi réel.
process.env.MAIL_TRANSPORT = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const jwt = require('jsonwebtoken');
const migrate = require('../src/migrate');
const db = require('../src/db');
const config = require('../src/config');
const { sent, simulerEchec } = require('../src/services/mailer');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
const ecoles = []; // ids des écoles créées (nettoyées à la fin)
let base; let server; let schoolId; let slug; let admin; let adminEmail;
let ip = '10.0.0.1'; // IP simulée du client (le serveur lit X-Forwarded-For) : chaque groupe de tests a son propre quota de requêtes publiques
const depuis = (n) => { ip = `10.0.0.${n}`; };

async function call(token, method, url, body, raw, extraHeaders = {}) {
  const headers = raw !== undefined && typeof raw !== 'object' ? { 'Content-Type': 'application/json', ...extraHeaders } : raw ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  headers['X-Forwarded-For'] = ip;
  const res = await fetch(base + url, { method, headers, body: typeof raw === 'string' ? raw : raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json().catch(() => null) : await res.text() };
}
const form = (champs, fichier) => { const fd = new FormData(); for (const [k, v] of Object.entries(champs)) fd.append(k, v); if (fichier) fd.append(fichier.champ, new Blob([fichier.contenu], { type: fichier.type }), fichier.nom); return fd; };
const dossierEcole = () => path.join(config.uploadDir, String(schoolId));
const fichiersEcole = () => (fs.existsSync(dossierEcole()) ? fs.readdirSync(dossierEcole()).sort() : []);
const dernierMail = (to) => [...sent].reverse().find((m) => m.to === to);
const codeDe = (mail) => /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(mail.text)[1];
const futur = () => new Date(Date.now() + 5 * 864e5).toISOString();

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminEmail = `dir-${stamp}@audit.test`;
  const r = await call(null, 'POST', '/api/public/signup', { nom: `Audit ${stamp}`, email: adminEmail, password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.verification_requise, undefined, 'sans SMTP configuré, l\'inscription reste ouverte comme avant');
  slug = r.data.slug;
  schoolId = (await db.qa('SELECT id FROM schools WHERE slug=$1', [slug])).rows[0].id; ecoles.push(schoolId);
  admin = (await call(null, 'POST', '/api/auth/login', { email: adminEmail, password: PW })).data.token;
});
test.after(async () => {
  const tables = (await db.qa("SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((x) => x.table_name);
  for (const id of ecoles) {
    for (let pass = 0; pass < 8; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id=$1`, [id]).catch(() => {});
    await db.qa('DELETE FROM schools WHERE id=$1', [id]).catch(() => {});
    fs.rmSync(path.join(config.uploadDir, String(id)), { recursive: true, force: true });
  }
  await new Promise((r) => server.close(r)); await db.end();
});

// ---------------------------------------------------------------- saisies invalides : 400 explicite, jamais 500
test('dates impossibles (30 février, 0, texte) : élève et pré-inscription refusés avec un message, pas d\'erreur 500', async () => {
  for (const d of ['2018-02-30', 0, 'abc', '2018-13-01', '2018-04-31']) {
    const r = await call(admin, 'POST', '/api/eleves', { nom: 'Date', prenom: 'Test', date_naissance: d, password: PW, password_confirm: PW });
    assert.equal(r.status, 400, `élève date ${JSON.stringify(d)} : ${r.status} ${JSON.stringify(r.data)}`);
  }
  const pre = await call(null, 'POST', `/api/public/${slug}/preinscriptions`, { eleve_nom: 'Date', eleve_prenom: 'Pre', date_naissance: '2018-02-30', parent_nom: 'Parent', parent_prenom: 'Test', parent_email: 'p@audit.test', consentement_rgpd: true });
  assert.equal(pre.status, 400, JSON.stringify(pre.data));
  assert.match(pre.data.error, /date/i);
  const ok = await call(admin, 'POST', '/api/eleves', { nom: 'Date', prenom: 'Valide', date_naissance: '2018-05-01', password: PW, password_confirm: PW });
  assert.equal(ok.status, 201, JSON.stringify(ok.data)); assert.equal(ok.data.date_naissance, '2018-05-01');
});
test('identifiants numériques hors limites, caractère NUL et JSON mal formé : 400 (et non 500)', async () => {
  assert.equal((await call(admin, 'POST', '/api/paiements', { eleve_id: 99999999999, montant: 10, mode: 'especes' })).status, 400);
  assert.equal((await call(admin, 'POST', '/api/absences', { eleve_id: 99999999999, date_absence: '2026-11-18' })).status, 400);
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre: 'Titre\u0000NUL', corps: 'Contenu valide', audience: 'tous' })).status, 400);
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre: 'Titre valide', corps: 'Contenu\u0001', audience: 'tous' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'a\u0000@b.tn', password: 'x' })).status, 400);
  const cassé = await call(null, 'POST', '/api/auth/login', undefined, '{"email":', { });
  assert.equal(cassé.status, 400, `JSON mal formé : ${cassé.status}`);
  const ok = await call(admin, 'POST', '/api/annonces', { titre: 'Annonce valide', corps: 'Avec un\nretour à la ligne', audience: 'tous' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});
test('pré-inscription publique : le consentement RGPD doit être réellement donné (true), pas la chaîne « false »', async () => {
  depuis(2);
  const base_ = { eleve_nom: 'Rgpd', eleve_prenom: 'Test', date_naissance: '2018-05-01', parent_nom: 'Parent', parent_prenom: 'Test', parent_email: `rgpd-${stamp}@audit.test` };
  for (const v of ['false', 0, null, undefined, 'oui']) {
    const r = await call(null, 'POST', `/api/public/${slug}/preinscriptions`, { ...base_, consentement_rgpd: v });
    assert.equal(r.status, 400, `consentement ${JSON.stringify(v)} accepté à tort`);
  }
  assert.equal((await call(null, 'POST', `/api/public/${slug}/preinscriptions`, { ...base_, consentement_rgpd: true })).status, 201);
});

// ---------------------------------------------------------------- fichiers
test('upload : un .html déguisé en text/plain est refusé, un vrai .txt passe et reste du texte', async () => {
  const avant = fichiersEcole();
  const evil = await call(admin, 'POST', '/api/messages', null, form({ destinataires: '[]', objet: 'x', corps: 'x', brouillon: 'true' }, { champ: 'fichiers', contenu: '<script>alert(1)</script>', type: 'text/plain', nom: 'evil.html' }));
  assert.equal(evil.status, 400, JSON.stringify(evil.data));
  const svg = await call(admin, 'POST', '/api/messages', null, form({ destinataires: '[]', objet: 'x', corps: 'x', brouillon: 'true' }, { champ: 'fichiers', contenu: '<svg onload=alert(1)>', type: 'image/png', nom: 'a.svg' }));
  assert.equal(svg.status, 400, 'svg déclaré image/png');
  assert.deepEqual(fichiersEcole(), avant, 'aucun fichier refusé ne doit rester sur le disque');
  const ok = await call(admin, 'POST', '/api/messages', null, form({ destinataires: '[]', objet: 'x', corps: 'x', brouillon: 'true' }, { champ: 'fichiers', contenu: 'bonjour', type: 'text/plain', nom: 'note.txt' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const stocke = fichiersEcole().find((f) => !avant.includes(f));
  assert.match(stocke, /^[a-f0-9]{32}\.txt$/);
  const lu = await call(admin, 'GET', `/api/files/${stocke}`);
  assert.equal(lu.status, 200); assert.match(lu.headers.get('content-type'), /^text\/plain/);
});
test('upload : fichiers déjà reçus supprimés quand la requête est refusée ensuite (pas d\'orphelins)', async () => {
  const avant = fichiersEcole();
  const r = await call(admin, 'POST', '/api/messages', null, form({ destinataires: 'pas-du-json', objet: 'x', corps: 'x' }, { champ: 'fichiers', contenu: 'bonjour', type: 'text/plain', nom: 'ok.txt' }));
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(fichiersEcole(), avant);
});
test('fichiers anciens dangereux (.html déjà stockés) : servis en téléchargement, jamais comme page web', async () => {
  fs.mkdirSync(dossierEcole(), { recursive: true });
  const nom = `${'a'.repeat(32)}.html`; fs.writeFileSync(path.join(dossierEcole(), nom), '<script>alert(1)</script>');
  const r = await call(admin, 'GET', `/api/files/${nom}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition') || '', /attachment/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
test('devoir : on ne peut retirer que les fichiers du devoir modifié, et la liste doit être valide', async () => {
  const classe = (await call(admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 25 })).data;
  const matiere = (await call(admin, 'POST', '/api/matieres', { nom: `Maths ${stamp}`, coefficient: 2 })).data;
  const mk = async (titre, nomFichier) => (await call(admin, 'POST', '/api/devoirs', null, form({ titre, matiere_id: matiere.id, classe_id: classe.id, date_remise: futur() }, { champ: 'fichiers', contenu: titre, type: 'text/plain', nom: nomFichier }))).data;
  const A = await mk('Devoir A', 'a.txt'); const B = await mk('Devoir B', 'b.txt');
  assert.ok(A.id && B.id, 'devoirs créés');
  const fichierB = B.fichiers[0].name; const fichierA = A.fichiers[0].name;
  const put = (id, remove) => call(admin, 'PUT', `/api/devoirs/${id}`, null, form({ remove_files: remove }));
  assert.equal((await put(A.id, 'pas du json')).status, 400);
  assert.equal((await put(A.id, '{"a":1}')).status, 400);
  assert.equal((await put(A.id, JSON.stringify([fichierB]))).status, 200);
  assert.ok(fichiersEcole().includes(fichierB), 'le fichier d\'un AUTRE devoir ne doit pas être supprimé');
  assert.ok(fichiersEcole().includes(fichierA));
  assert.equal((await put(A.id, JSON.stringify([fichierA]))).status, 200);
  assert.ok(!fichiersEcole().includes(fichierA), 'le fichier du devoir modifié est bien retiré');
});

// ---------------------------------------------------------------- export CSV, push
test('export CSV des élèves : une cellule commençant par = + - @ ne devient pas une formule Excel', async () => {
  const c = await call(admin, 'POST', '/api/eleves', { nom: 'Formule', prenom: 'Csv', date_naissance: '2018-05-01', adresse: '=HYPERLINK("http://evil.example","clic")', password: PW, password_confirm: PW });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const csv = (await call(admin, 'GET', '/api/eleves/export')).data;
  assert.ok(csv.includes('"\'=HYPERLINK('), 'la formule doit être neutralisée par une apostrophe');
  assert.ok(!/;"=HYPERLINK/.test(csv), 'aucune cellule ne doit commencer par =');
});
test('abonnement push : formats web et mobile acceptés, valeurs invalides refusées', async () => {
  const sub = (body) => call(admin, 'POST', '/api/push/subscribe', body);
  assert.equal((await sub({ endpoint: 'fcm:abcdefghijklmnop', keys: { platform: 'android' } })).status, 200, 'mobile (FCM)');
  assert.equal((await sub({ endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'k', auth: 'a' } })).status, 200, 'navigateur');
  for (const bad of [{ endpoint: 'x\u0000y12345', keys: {} }, { endpoint: 'ftp://x.example/abc', keys: {} }, { endpoint: 'https://x.example/a', keys: 'chaine' }, { endpoint: 12345678, keys: {} }, { endpoint: 'https://x.example/a' }, { endpoint: 'fcm:ok123456', keys: [1] }])
    assert.equal((await sub(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call(admin, 'POST', '/api/push/unsubscribe', { endpoint: 'fcm:abcdefghijklmnop' })).status, 200);
  assert.equal((await call(admin, 'POST', '/api/push/unsubscribe', { endpoint: { a: 1 } })).status, 400);
});

// ---------------------------------------------------------------- secret JWT
test('secret JWT : jamais une valeur publique connue ; la production refuse les valeurs d\'exemple', async () => {
  const forge = jwt.sign({ sub: 1, role: 'admin', sch: schoolId }, 'dev-only-secret-change-me');
  assert.equal((await call(forge, 'GET', '/api/auth/me')).status, 401, 'jeton signé avec l\'ancien secret par défaut');
  const run = (env) => { try { return execFileSync(process.execPath, ['-e', "const c=require('./src/config');process.stdout.write(c.jwtSecret)"], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return { erreur: String(e.stderr) }; } };
  const a = run({}); const b = run({});
  assert.ok(a.length >= 64 && a !== b, 'sans JWT_SECRET (développement) : secret aléatoire différent à chaque démarrage');
  assert.ok(run({ NODE_ENV: 'production' }).erreur.includes('JWT_SECRET'), 'production sans secret');
  for (const s of ['change-me-please-with-a-long-random-string', 'remplacez-moi-par-une-longue-chaine-aleatoire-32-car-min', 'court'])
    assert.ok(run({ NODE_ENV: 'production', JWT_SECRET: s }).erreur?.includes('JWT_SECRET'), `production avec « ${s} »`);
  const fort = 'k'.repeat(40); assert.equal(run({ NODE_ENV: 'production', JWT_SECRET: fort }), fort, 'production avec un vrai secret');
});

// ---------------------------------------------------------------- mot de passe oublié (e-mail réel simulé en mémoire)
test('mot de passe oublié : e-mail avec code → nouveau mot de passe → ancien refusé, code à usage unique', async () => {
  const mail = `oubli-${stamp}@audit.test`; const ancien = 'Ancien@2026a';
  await call(admin, 'POST', '/api/users', { email: mail, nom: 'Oubli', prenom: 'Test', role: 'parent', password: ancien });
  const avant = sent.length;
  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: 'pas-un-email' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: 'a@b' })).status, 400);
  const inconnu = await call(null, 'POST', '/api/auth/forgot-password', { email: `inconnu-${stamp}@audit.test` });
  assert.equal(inconnu.status, 200); assert.equal(sent.length, avant, 'adresse inconnue : même réponse, aucun e-mail');
  const dem = await call(null, 'POST', '/api/auth/forgot-password', { email: mail });
  assert.equal(dem.status, 200); assert.equal(sent.length, avant + 1);
  const m = dernierMail(mail); assert.match(m.subject, /mot de passe/i); const code = codeDe(m);
  const set = (body) => call(null, 'POST', '/api/auth/set-password', { email: mail, ...body });
  assert.equal((await set({ code: 'AAAAA-BBBBB', password: 'Nouveau@2026b' })).status, 400, 'mauvais code');
  assert.equal((await set({ code, password: 'court1' })).status, 400, 'mot de passe trop court');
  assert.equal((await set({ code, password: 'Nouveau@2026b', confirmation: 'Autre@2026c' })).status, 400, 'confirmation différente');
  assert.equal((await set({ code, password: mail })).status, 400, 'mot de passe = e-mail');
  assert.equal((await set({ code, password: 'Nouveau@2026b', confirmation: 'Nouveau@2026b' })).status, 200);
  assert.equal((await set({ code, password: 'Encore@2026d' })).status, 400, 'code déjà utilisé');
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: ancien })).status, 401);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: 'Nouveau@2026b' })).status, 200);
});

// ---------------------------------------------------------------- vérification d'e-mail à l'inscription
test('inscription : adresse e-mail confirmée par code avant la première connexion (quand l\'envoi d\'e-mail est actif)', async () => {
  depuis(3);
  process.env.VERIFY_SIGNUP_EMAIL = 'true';
  try {
    const mail = `verif-${stamp}@audit.test`;
    const s1 = await call(null, 'POST', '/api/public/signup', { nom: `Verif ${stamp}`, email: mail, password: PW });
    assert.equal(s1.status, 201, JSON.stringify(s1.data));
    assert.equal(s1.data.verification_requise, true); assert.equal(s1.data.email_envoye, true);
    ecoles.push((await db.qa('SELECT id FROM schools WHERE slug=$1', [s1.data.slug])).rows[0].id);
    const code1 = codeDe(dernierMail(mail));
    const login = await call(null, 'POST', '/api/auth/login', { email: mail, password: PW });
    assert.equal(login.status, 403); assert.equal(login.data.code, 'email_not_verified');
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: 'AAAAA-BBBBB' })).status, 400, 'mauvais code');
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail })).status, 400, 'code manquant');
    // renvoi : nouveau code, l'ancien devient invalide
    const re = await call(null, 'POST', '/api/public/resend-verification', { email: mail }); assert.equal(re.status, 200);
    const code2 = codeDe(dernierMail(mail)); assert.notEqual(code2, code1);
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: code1 })).status, 400, 'ancien code invalidé par le renvoi');
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: code2 })).status, 200);
    assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: PW })).status, 200, 'connexion possible une fois confirmée');
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: code2 })).status, 400, 'code à usage unique');
    assert.equal((await call(null, 'POST', '/api/public/signup', { nom: `Verif2 ${stamp}`, email: mail, password: PW })).status, 409, 'adresse confirmée : non réutilisable');
  } finally { delete process.env.VERIFY_SIGNUP_EMAIL; }
});
test('inscription non confirmée : la même adresse peut la reprendre (pas de blocage par un tiers), et l\'ancien mot de passe ne marche pas', async () => {
  depuis(4);
  process.env.VERIFY_SIGNUP_EMAIL = 'true';
  try {
    const mail = `reprise-${stamp}@audit.test`;
    const a = await call(null, 'POST', '/api/public/signup', { nom: `Squat ${stamp}`, email: mail, password: 'Pirate@2026a' });
    assert.equal(a.status, 201); ecoles.push((await db.qa('SELECT id FROM schools WHERE slug=$1', [a.data.slug])).rows[0].id);
    const b = await call(null, 'POST', '/api/public/signup', { nom: `Vrai ${stamp}`, email: mail, password: 'Proprio@2026b' });
    assert.equal(b.status, 201, JSON.stringify(b.data)); assert.equal(b.data.slug, a.data.slug, 'même inscription en attente reprise, pas de doublon d\'école');
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: codeDe(dernierMail(mail)) })).status, 200);
    assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: 'Pirate@2026a' })).status, 401);
    const ok = await call(null, 'POST', '/api/auth/login', { email: mail, password: 'Proprio@2026b' });
    assert.equal(ok.status, 200); assert.equal(ok.data.user.school.nom, `Vrai ${stamp}`);
  } finally { delete process.env.VERIFY_SIGNUP_EMAIL; }
});
test('inscription : panne d\'envoi d\'e-mail signalée (compte créé, renvoi possible) ; mot de passe = e-mail refusé', async () => {
  depuis(5);
  process.env.VERIFY_SIGNUP_EMAIL = 'true';
  try {
    const mail = `panne-${stamp}@audit.test`;
    simulerEchec('SMTP indisponible');
    const s = await call(null, 'POST', '/api/public/signup', { nom: `Panne ${stamp}`, email: mail, password: PW });
    simulerEchec(null);
    assert.equal(s.status, 201, JSON.stringify(s.data)); assert.equal(s.data.email_envoye, false); assert.match(s.data.erreur, /SMTP/);
    ecoles.push((await db.qa('SELECT id FROM schools WHERE slug=$1', [s.data.slug])).rows[0].id);
    await call(null, 'POST', '/api/public/resend-verification', { email: mail });
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code: codeDe(dernierMail(mail)) })).status, 200, 'après la panne, le renvoi permet de confirmer');
    const egal = await call(null, 'POST', '/api/public/signup', { nom: `Egal ${stamp}`, email: `egal-${stamp}@audit.test`, password: `egal-${stamp}@audit.test` });
    assert.equal(egal.status, 400);
  } finally { simulerEchec(null); delete process.env.VERIFY_SIGNUP_EMAIL; }
});

// ---------------------------------------------------------------- e-mails de notification : un seul transport
test('notifications par e-mail (annonce) : passent par le transport commun, avec le nom de l\'école dans l\'objet', async () => {
  const mail = `parent-notif-${stamp}@audit.test`;
  const p = await call(admin, 'POST', '/api/users', { email: mail, nom: 'Notif', prenom: 'Parent', role: 'parent', password: PW });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const titre = `Réunion ${stamp}`;
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre, corps: 'Réunion des parents vendredi', audience: 'parents' })).status, 201);
  let m; for (let i = 0; i < 30 && !m; i++) { m = sent.find((x) => x.to === mail && x.subject.includes(titre)); if (!m) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(m, 'e-mail d\'annonce reçu par le parent');
  assert.ok(m.subject.startsWith(`[Audit ${stamp}]`), m.subject);
  const journal = (await db.qa("SELECT statut FROM notification_log WHERE canal='email' AND user_id=$1 AND sujet LIKE $2", [p.data.id, `%${titre}%`])).rows;
  assert.deepEqual(journal.map((x) => x.statut), ['envoye'], 'envoi journalisé');
  // panne SMTP : l'annonce est publiée quand même, l'échec est journalisé
  const titre2 = `Panne ${stamp}`; simulerEchec('SMTP indisponible');
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre: titre2, corps: 'Annonce pendant une panne', audience: 'parents' })).status, 201);
  let echec; for (let i = 0; i < 30 && !echec; i++) { echec = (await db.qa("SELECT erreur FROM notification_log WHERE canal='email' AND user_id=$1 AND sujet LIKE $2 AND statut='echec'", [p.data.id, `%${titre2}%`])).rows[0]; if (!echec) await new Promise((r) => setTimeout(r, 100)); }
  simulerEchec(null);
  assert.ok(echec && /SMTP/.test(echec.erreur), 'échec d\'envoi journalisé');
});

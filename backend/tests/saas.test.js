// Tests SaaS : inscription libre-service d'une école (essai 30 jours) et quotas par formule.
// Lancer : DATABASE_URL=postgres://… npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let schoolId; let admin;

async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (schoolId) {
    for (let pass = 0; pass < 6; pass++) for (const t of ['audit_log', 'access_log', 'notification_log', 'notifications', 'eleves', 'users']) await db.qa(`DELETE FROM ${t} WHERE school_id=$1`, [schoolId]).catch(() => {});
    await db.qa('DELETE FROM schools WHERE id=$1', [schoolId]).catch(() => {});
  }
  await new Promise((r) => server.close(r)); await db.end();
});

test('inscription libre-service : école créée en essai de 30 jours, connexion possible', async () => {
  const r = await call(null, 'POST', '/api/public/signup', { nom: `École Test ${stamp}`, email: `dir-${stamp}@signup.test`, password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const s = (await db.qa('SELECT * FROM schools WHERE slug=$1', [r.data.slug])).rows[0];
  schoolId = s.id;
  assert.equal(s.status, 'trial'); assert.equal(s.plan, 'basic');
  const jours = Math.round((new Date(s.subscription_end) - new Date(new Date().toISOString().slice(0, 10))) / 864e5);
  assert.ok(jours >= 29 && jours <= 31, `essai de ${jours} jours`);
  const l = await call(null, 'POST', '/api/auth/login', { email: `dir-${stamp}@signup.test`, password: PW });
  assert.equal(l.status, 200); assert.equal(l.data.user.role, 'admin'); admin = l.data.token;
});

test('inscription : e-mail déjà utilisé, mot de passe faible et nom manquant refusés', async () => {
  assert.equal((await call(null, 'POST', '/api/public/signup', { nom: 'Autre école', email: `dir-${stamp}@signup.test`, password: PW })).status, 409);
  assert.equal((await call(null, 'POST', '/api/public/signup', { nom: 'Autre école', email: `x-${stamp}@signup.test`, password: 'court' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/public/signup', { email: `y-${stamp}@signup.test`, password: PW })).status, 400);
});

test('inscription : deux écoles de même nom reçoivent des identifiants distincts', async () => {
  const r = await call(null, 'POST', '/api/public/signup', { nom: `École Test ${stamp}`, email: `dir2-${stamp}@signup.test`, password: PW });
  assert.equal(r.status, 201);
  const s = (await db.qa('SELECT id, slug FROM schools WHERE slug=$1', [r.data.slug])).rows[0];
  assert.notEqual(s.id, schoolId);
  for (const t of ['audit_log', 'users']) await db.qa(`DELETE FROM ${t} WHERE school_id=$1`, [s.id]);
  await db.qa('DELETE FROM schools WHERE id=$1', [s.id]);
});

test('quota élèves : formule Basic limitée à 50, levée en changeant de formule', async () => {
  await db.qa("INSERT INTO eleves(school_id,nom,prenom) SELECT $1,'Quota','E'||g FROM generate_series(1,50) g", [schoolId]);
  const refus = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Trop', prenom: 'Plein', date_naissance: '2018-05-05', statut: 'actif' });
  assert.equal(refus.status, 402, JSON.stringify(refus.data));
  assert.match(refus.data.error, /Limite de votre formule/);
  await db.qa("UPDATE schools SET plan='standard' WHERE id=$1", [schoolId]);
  const ok = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Passe', prenom: 'Bien', date_naissance: '2018-05-05', statut: 'actif' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test('quota utilisateurs : formule Basic limitée à 20 comptes', async () => {
  await db.qa("UPDATE schools SET plan='basic' WHERE id=$1", [schoolId]);
  const n = Number((await db.qa('SELECT COUNT(*) n FROM users WHERE school_id=$1 AND deleted_at IS NULL AND role<>\'eleve\'', [schoolId])).rows[0].n);
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) SELECT 'q'||g||'-'||$2||'@quota.test','x','parent','Quota','P'||g,$1 FROM generate_series(1,$3::int) g", [schoolId, stamp, 20 - n]);
  const refus = await call(admin, 'POST', '/api/users', { nom: 'Trop', prenom: 'Plein', email: `trop-${stamp}@quota.test`, role: 'parent', password: PW });
  assert.equal(refus.status, 402, JSON.stringify(refus.data));
});

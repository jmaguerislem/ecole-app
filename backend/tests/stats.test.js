// Tests : statistiques globales du super-administrateur (toutes les écoles) – calculées en base, droits par rôle, mise à jour immédiate.
// (Les statistiques d'une école pour son directeur sont testées dans stats-ecole.test.js.)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1'; const stamp = Date.now().toString(36);
let base; let server; let sup; const E = {}; const ids = [];
async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async (email) => (await call(null, 'POST', '/api/auth/login', { email, password: PW })).data.token;
const un = async (sql, p) => Number((await db.qa(sql, p)).rows[0].n);

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@st.test`, await bcrypt.hash(PW, 4)]);
  sup = await login(`sa-${stamp}@st.test`);
  for (const [k, status, ville] of [['A', 'active', 'Tunis'], ['B', 'trial', 'Sfax'], ['C', 'active', 'Gabès']]) {
    const r = await call(sup, 'POST', '/api/saas/schools', { nom: `Stats ${k} ${stamp}`, ville, status, plan: 'standard', admin: { email: `dir-${k}-${stamp}@st.test`, password: PW } });
    assert.equal(r.status, 201, JSON.stringify(r.data)); E[k] = { id: r.data.id, token: await login(`dir-${k}-${stamp}@st.test`) }; ids.push(r.data.id);
  }
  await call(E.A.token, 'POST', '/api/users', { nom: 'Ens', prenom: 'Un', email: `ens-${stamp}@st.test`, role: 'enseignant', password: PW });
  await call(E.A.token, 'POST', '/api/users', { nom: 'Par', prenom: 'Un', email: `par-${stamp}@st.test`, role: 'parent', password: PW });
  for (const n of ['Un', 'Deux']) await call(E.B.token, 'POST', '/api/eleves', { nom: 'Bravo', prenom: n === 'Un' ? 'Ali' : 'Omar', date_naissance: '2018-05-05', password: PW, password_confirm: PW });
  await call(sup, 'PUT', `/api/saas/schools/${E.C.id}`, { status: 'suspended' });
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@st.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

test('statistiques globales : totaux identiques aux données réelles de la base, super-administrateur compris', async () => {
  const g = (await call(sup, 'GET', '/api/stats/global')).data;
  assert.equal(g.totaux.ecoles, await un('SELECT COUNT(*) n FROM schools'));
  assert.equal(g.totaux.directeurs, await un("SELECT COUNT(*) n FROM users WHERE role='admin' AND deleted_at IS NULL"));
  assert.equal(g.totaux.utilisateurs, await un('SELECT COUNT(*) n FROM users WHERE deleted_at IS NULL'), 'tous les comptes, super-administrateur inclus');
  assert.equal(g.totaux.superadmins, await un("SELECT COUNT(*) n FROM users WHERE role='superadmin' AND deleted_at IS NULL"));
  assert.equal(g.totaux.eleves, await un('SELECT COUNT(*) n FROM eleves WHERE deleted_at IS NULL'));
  for (const s of ['active', 'suspended', 'trial']) assert.equal(g.statuts[s], await un('SELECT COUNT(*) n FROM schools WHERE status=$1', [s]), `statut ${s}`);
  assert.equal(g.statuts.active + g.statuts.suspended + g.statuts.trial, g.totaux.ecoles);
  const a = g.ecoles.find((x) => x.id === E.A.id); const b = g.ecoles.find((x) => x.id === E.B.id); const c = g.ecoles.find((x) => x.id === E.C.id);
  assert.deepEqual([a.directeurs, a.enseignants, a.parents, a.utilisateurs, a.eleves], [1, 1, 1, 3, 0]);
  assert.deepEqual([b.directeurs, b.eleves, b.comptes_eleves, b.utilisateurs], [1, 2, 2, 3]);
  assert.deepEqual([a.status, b.status, c.status], ['active', 'trial', 'suspended']);
  assert.ok(g.ecoles.every((x) => x.liste_directeurs.length === x.directeurs), 'le super-administrateur voit les directeurs de chaque école');
  assert.equal(g.ecoles.reduce((t, x) => t + x.utilisateurs, 0) + g.totaux.superadmins, g.totaux.utilisateurs);
});

test("un directeur ne voit PAS les statistiques globales : /global lui est refusé, et son école seule est accessible", async () => {
  assert.equal((await call(E.A.token, 'GET', '/api/stats/global')).status, 403);
  const mine = await call(E.A.token, 'GET', '/api/stats/mon-ecole');
  assert.equal(mine.status, 200); assert.equal(mine.data.ecole.id, E.A.id);
  assert.deepEqual([mine.data.utilisateurs.directeurs, mine.data.utilisateurs.enseignants, mine.data.utilisateurs.parents, mine.data.utilisateurs.total, mine.data.eleves.total], [1, 1, 1, 3, 0]);
  const txt = JSON.stringify(mine.data);
  assert.ok(!txt.includes(`Stats B ${stamp}`) && !txt.includes(`Stats C ${stamp}`) && !txt.includes('@st.test'), "aucune trace des autres écoles ni de leurs e-mails");
  assert.equal((await call(E.A.token, 'GET', `/api/stats/ecole/${E.B.id}`)).status, 404, "une autre école est introuvable pour un directeur");
});

test('droits : refusé sans connexion et aux enseignants, parents, comptables, élèves', async () => {
  assert.equal((await call(null, 'GET', '/api/stats/global')).status, 401);
  await call(E.A.token, 'POST', '/api/users', { nom: 'Cpt', prenom: 'Un', email: `cpt-${stamp}@st.test`, role: 'comptable', password: PW });
  for (const em of ['ens', 'par', 'cpt']) assert.equal((await call(await login(`${em}-${stamp}@st.test`), 'GET', '/api/stats/global')).status, 403, em);
  const eleveEmail = (await db.qa("SELECT email FROM users WHERE school_id=$1 AND role='eleve' LIMIT 1", [E.B.id])).rows[0].email;
  assert.equal((await call(await login(eleveEmail), 'GET', '/api/stats/global')).status, 403, 'élève');
});

test('détail d’une école séparément, et mise à jour immédiate après une modification', async () => {
  const d = await call(sup, 'GET', `/api/stats/ecole/${E.B.id}`);
  assert.equal(d.status, 200); assert.equal(d.data.ecole.id, E.B.id); assert.equal(d.data.ecole.eleves, 2);
  assert.equal((await call(sup, 'GET', '/api/stats/ecole/999999')).status, 404);
  await call(E.B.token, 'POST', '/api/eleves', { nom: 'Bravo', prenom: 'Sami', date_naissance: '2018-05-05', password: PW, password_confirm: PW });
  assert.equal((await call(sup, 'GET', `/api/stats/ecole/${E.B.id}`)).data.ecole.eleves, 3, 'nouvel élève compté aussitôt');
  await call(sup, 'PUT', `/api/saas/schools/${E.C.id}`, { status: 'active' });
  const g = (await call(sup, 'GET', '/api/stats/global')).data;
  assert.equal(g.ecoles.find((x) => x.id === E.C.id).status, 'active'); assert.equal(g.statuts.suspended, await un("SELECT COUNT(*) n FROM schools WHERE status='suspended'"));
});

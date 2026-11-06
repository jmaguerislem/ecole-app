// Tests : e-mail élève unique, tarifs par niveau (+50 DT/an, historique), annonces ciblées, photo, confirmation du mot de passe.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let schoolId; let admin; let adminId;

async function call(token, method, url, body, raw) {
  const headers = raw ? {} : { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call(null, 'POST', '/api/public/signup', { nom: `Evo ${stamp}`, email: `dir-${stamp}@evo.test`, password: PW });
  schoolId = (await db.qa('SELECT id FROM schools WHERE slug=$1', [r.data.slug])).rows[0].id;
  const l = await call(null, 'POST', '/api/auth/login', { email: `dir-${stamp}@evo.test`, password: PW });
  admin = l.data.token; adminId = l.data.user.id;
});
test.after(async () => {
  for (let pass = 0; pass < 6; pass++) for (const t of ['tarifs_historique', 'tarifs', 'annonces', 'audit_log', 'access_log', 'notification_log', 'notifications', 'eleve_parents', 'eleves', 'classes', 'users']) await db.qa(`DELETE FROM ${t} WHERE school_id=$1`, [schoolId]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id=$1', [schoolId]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

test('e-mail élève : généré, jamais saisi, unique (même nom → variantes)', async () => {
  const a = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Ben Àli', prenom: 'Mohamed', date_naissance: '2018-05-01', email: 'pirate@x.tn' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.match(a.data.email, /^mohamed\.ben-ali@.+\.tn$/);
  const b = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Ben Àli', prenom: 'Mohamed', date_naissance: '2018-09-09' });
  const c = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Ben Àli', prenom: 'Mohamed', date_naissance: '2018-10-10' });
  assert.equal(new Set([a.data.email, b.data.email, c.data.email]).size, 3);
  const sg = await call(admin, 'GET', '/api/eleves/email-suggestion?nom=Ben%20Ali&prenom=Mohamed');
  assert.equal(sg.status, 200); assert.notEqual(sg.data.email, a.data.email, 'suggestion déjà prise → variante');
  const up = await call(admin, 'PUT', `/api/eleves/${a.data.id}`, { prenom: 'Autre', email: 'x@y.tn' });
  assert.equal(up.data.email, a.data.email, "l'e-mail ne change pas à la modification");
});
test('e-mail élève : ne peut pas reprendre l’e-mail d’un compte existant', async () => {
  const dom = (await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Zed', prenom: 'Zoe', date_naissance: '2017-01-01' })).data.email.split('@')[1];
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,'x','parent','P','P',$2)", [`lina.dupont@${dom}`, schoolId]);
  const e = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Dupont', prenom: 'Lina', date_naissance: '2017-02-02' });
  assert.notEqual(e.data.email, `lina.dupont@${dom}`);
});
test('photo : image acceptée, faux fichier et mauvais format refusés', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('photo', new Blob([png], { type: 'image/png' }), 'a.png');
  const r = await call(admin, 'POST', '/api/eleves/photo', null, fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const el = await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Photo', prenom: 'Eva', date_naissance: '2017-03-03', photo: r.data.photo });
  assert.equal(el.data.photo, r.data.photo);
  const bad = new FormData(); bad.append('photo', new Blob(['<html>'], { type: 'image/png' }), 'a.png');
  assert.equal((await call(admin, 'POST', '/api/eleves/photo', null, bad)).status, 400);
  const bad2 = new FormData(); bad2.append('photo', new Blob(['x'], { type: 'text/html' }), 'a.html');
  assert.equal((await call(admin, 'POST', '/api/eleves/photo', null, bad2)).status, 400);
  assert.equal((await call(admin, 'POST', '/api/eleves', { password: PW, password_confirm: PW, nom: 'Fake', prenom: 'Eva', photo: '/api/files/' + 'a'.repeat(32) + '.jpg' })).status, 400);
});
test('tarifs : prix par niveau, +50 DT/an automatique, historique conservé', async () => {
  const bad = await call(admin, 'POST', '/api/tarifs', { libelle: 'Scolarité', type: 'scolarite', montant: 500, annee_scolaire: '2024-2025' });
  assert.equal(bad.status, 400, 'scolarité sans niveau refusée');
  const n1 = await call(admin, 'POST', '/api/tarifs', { libelle: 'Scolarité – 1ère année', type: 'scolarite', niveau: '1ère année', montant: 600, annee_scolaire: '2024-2025' });
  assert.equal(n1.status, 201, JSON.stringify(n1.data));
  await call(admin, 'POST', '/api/tarifs', { libelle: 'Scolarité – 2ème année', type: 'scolarite', niveau: '2ème année', montant: 700, annee_scolaire: '2024-2025' });
  assert.equal((await call(admin, 'POST', '/api/tarifs', { libelle: 'Doublon', type: 'scolarite', niveau: '1ère année', montant: 1, annee_scolaire: '2024-2025' })).status, 409);
  const g = await call(admin, 'POST', '/api/tarifs/generer', { annee: '2025-2026' });
  assert.equal(g.data.crees, 2);
  const t26 = (await call(admin, 'GET', '/api/tarifs?annee=2025-2026&type=scolarite')).data;
  assert.deepEqual(t26.map((t) => [t.niveau, t.montant]), [['1ère année', 650], ['2ème année', 750]]);
  assert.equal((await call(admin, 'POST', '/api/tarifs/generer', { annee: '2025-2026' })).data.crees, 0, 'idempotent');
  const cur = (await call(admin, 'GET', '/api/tarifs?type=scolarite')).data; // année courante : générée automatiquement à l'ouverture
  const an = require('../src/config').anneeCourante; const k = Number(an.slice(0, 4)) - 2024;
  assert.equal(cur.find((t) => t.niveau === '1ère année').montant, 600 + 50 * k);
  assert.equal((await call(admin, 'GET', '/api/tarifs?annee=2024-2025&type=scolarite')).data.find((t) => t.niveau === '1ère année').montant, 600, 'ancien tarif intact');
  await call(admin, 'PUT', `/api/tarifs/${n1.data.id}`, { montant: 620 });
  const h = (await call(admin, 'GET', '/api/tarifs/historique?niveau=1ère année')).data;
  assert.ok(h.some((x) => x.motif === 'creation') && h.some((x) => x.motif === 'augmentation_auto') && h.some((x) => x.motif === 'modification' && x.montant_ancien === 600 && x.montant_nouveau === 620));
});
test('annonces : destinataires personnalisés, élèves, enseignants, parents', async () => {
  const mk = async (role, n) => (await call(admin, 'POST', '/api/users', { nom: 'Dupont', prenom: 'Test', email: `${n}-${stamp}@evo.test`, role, password: PW, password_confirm: PW })).data;
  const p = await mk('parent', 'par'); const e = await mk('enseignant', 'ens'); const p2 = await mk('parent', 'parb');
  const tok = async (n) => (await call(null, 'POST', '/api/auth/login', { email: `${n}-${stamp}@evo.test`, password: PW })).data.token;
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre: 'Perso', corps: 'abc', audience: 'personne', destinataire_ids: [] })).status, 400);
  assert.equal((await call(admin, 'POST', '/api/annonces', { titre: 'Perso', corps: 'abc', audience: 'personne', destinataire_ids: [999999] })).status, 400);
  { const ok = await call(admin, 'POST', '/api/annonces', { titre: 'Perso', corps: 'abc', audience: 'personne', destinataire_ids: [p.id] }); assert.equal(ok.status, 201, JSON.stringify(ok.data)); }
  await call(admin, 'POST', '/api/annonces', { titre: 'Profs', corps: 'abc', audience: 'enseignants' });
  const vue = async (n) => (await call(await tok(n), 'GET', '/api/annonces')).data.map((a) => a.titre);
  assert.deepEqual(await vue('par'), ['Perso']);
  assert.deepEqual(await vue('parb'), []);
  assert.deepEqual(await vue('ens'), ['Profs']);
  assert.equal((await call(await tok('par'), 'GET', '/api/annonces')).data[0].destinataire_ids, undefined);
  void e; void p2;
});
test('mot de passe : confirmation vérifiée côté serveur', async () => {
  const r = await call(admin, 'POST', '/api/users', { nom: 'C', prenom: 'C', email: `c-${stamp}@evo.test`, role: 'parent', password: PW, password_confirm: 'Autre@2026x1' });
  assert.equal(r.status, 400);
  const ch = await call(admin, 'POST', '/api/auth/change-password', { ancien: PW, nouveau: 'Nouveau@2026', confirmation: 'Different1' });
  assert.equal(ch.status, 400);
  const list = (await call(admin, 'GET', '/api/users')).data;
  assert.ok(list.every((u) => u.password_hash === undefined && u.password === undefined));
  void adminId;
});

// ---- « Faire l'appel » : réservé aux enseignants (jamais le directeur), uniquement dans leurs classes ----
test("appel : refusé au directeur, au comptable, aux parents et élèves ; autorisé à l'enseignant dans ses classes seulement", async () => {
  const mk = async (role, n) => (await call(admin, 'POST', '/api/users', { nom: 'Dupont', prenom: 'Test', email: `${n}-${stamp}@evo.test`, role, password: PW, password_confirm: PW })).data;
  const tok = async (n) => (await call(null, 'POST', '/api/auth/login', { email: `${n}-${stamp}@evo.test`, password: PW })).data.token;
  const ens = await mk('enseignant', 'appelens'); await mk('comptable', 'appelcpt'); await mk('parent', 'appelpar');
  const classe = (await call(admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'Z', capacite: 25 })).data;
  const autre = (await call(admin, 'POST', '/api/classes', { niveau: '2ème année', section: 'Z', capacite: 25 })).data;
  const mat = (await call(admin, 'POST', '/api/matieres', { nom: 'Arabe', coefficient: 2 })).data;
  await call(admin, 'POST', '/api/affectations', { enseignant_id: ens.id, matiere_id: mat.id, classe_id: classe.id });
  const jour = new Date(Date.now() - 2 * 864e5); const d = jour.getUTCDay() === 0 ? new Date(Date.now() - 3 * 864e5) : jour; const date = d.toISOString().slice(0, 10);
  for (const [m, u] of [['GET', '/api/absences/appel/classes'], ['GET', `/api/absences/appel?classe_id=${classe.id}&date=${date}`], ['PUT', '/api/absences/appel']]) {
    assert.equal((await call(admin, m, u, m === 'PUT' ? { classe_id: classe.id, date_absence: date, absents: [] } : undefined)).status, 403, `directeur : ${m} ${u}`);
    for (const n of ['appelcpt', 'appelpar']) assert.equal((await call(await tok(n), m, u, m === 'PUT' ? { classe_id: classe.id, date_absence: date, absents: [] } : undefined)).status, 403, `${n} : ${m} ${u}`);
  }
  const t = await tok('appelens');
  const cl = await call(t, 'GET', '/api/absences/appel/classes');
  assert.equal(cl.status, 200); assert.deepEqual(cl.data.map((c) => c.id), [classe.id], 'seulement ses classes');
  assert.equal((await call(t, 'GET', `/api/absences/appel?classe_id=${classe.id}&date=${date}`)).status, 200);
  assert.equal((await call(t, 'PUT', '/api/absences/appel', { classe_id: classe.id, date_absence: date, absents: [] })).status, 200);
  assert.equal((await call(t, 'GET', `/api/absences/appel?classe_id=${autre.id}&date=${date}`)).status, 403, "classe d'un autre enseignant");
  // Les autres fonctions de la direction ne changent pas : elle peut toujours saisir/consulter les absences
  assert.equal((await call(admin, 'GET', '/api/absences')).status, 200);
});

// Tests : comptes de démonstration (connexion sans mot de passe), tableau de bord super-admin, profil, début d'abonnement,
// conflits d'emploi du temps (ajout / modification / suppression), isolation entre écoles.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const migrate = require('../src/migrate');
const db = require('../src/db');
const config = require('../src/config');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let sa; let saEmail; let saved = []; let demoSaved = false;
const E = []; // 3 écoles de test (groupes 1, 2, 3)
const ROLES = ['admin', 'comptable', 'enseignant', 'eleve', 'parent'];

async function call(token, method, url, body, raw) {
  const headers = raw ? {} : { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* binaire */ }
  return { status: res.status, data, text };
}
const must = async (token, method, url, body) => { const r = await call(token, method, url, body); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${r.text.slice(0, 200)}`); return r.data; };
const login = async (email, password = PW) => (await must(null, 'POST', '/api/auth/login', { email, password })).token;

const L = (n) => 'ABC'[n - 1];
async function creerEcole(n) {
  const slug = `sd-${n}-${stamp}`;
  const e = await must(sa, 'POST', '/api/saas/schools', { nom: `École Démo ${n} ${stamp}`, slug, ville: 'Tunis', status: 'active', plan: 'premium', admin: { email: `dir${n}-${stamp}@sd.tn`, nom: 'Direction', prenom: `Ecole${L(n)}`, password: PW } });
  const s = { n, id: e.id, slug, ids: {}, mails: { admin: `dir${n}-${stamp}@sd.tn` } };
  s.admin = await login(s.mails.admin);
  s.classe = (await must(s.admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 25 })).id;
  s.classe2 = (await must(s.admin, 'POST', '/api/classes', { niveau: '2ème année', section: 'A', capacite: 25 })).id;
  s.matiere = (await must(s.admin, 'POST', '/api/matieres', { nom: `Maths ${n}`, coefficient: 1 })).id;
  s.salle1 = (await must(s.admin, 'POST', '/api/salles', { nom: 'Salle 1', capacite: 25 })).id;
  s.salle2 = (await must(s.admin, 'POST', '/api/salles', { nom: 'Salle 2', capacite: 25 })).id;
  for (const role of ['comptable', 'enseignant', 'parent']) {
    s.mails[role] = `${role}${n}-${stamp}@sd.tn`;
    s.ids[role] = (await must(s.admin, 'POST', '/api/users', { nom: `Nom${role}`, prenom: `Pers${L(n)}`, email: s.mails[role], role, password: PW })).id;
  }
  s.ens2 = (await must(s.admin, 'POST', '/api/users', { nom: 'Autre', prenom: 'Prof', email: `ens2-${n}-${stamp}@sd.tn`, role: 'enseignant', password: PW })).id;
  const el = await must(s.admin, 'POST', '/api/eleves', { nom: `Eleve${L(n)}`, prenom: 'Test', date_naissance: '2018-05-05', classe_id: s.classe, statut: 'actif', password: PW, password_confirm: PW, parent_ids: [s.ids.parent] });
  s.eleveId = el.id; s.mails.eleve = el.email;
  return s;
}

test.before(async () => {
  await migrate();
  saEmail = `sa-sd-${stamp}@saas.test`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Test','Owner',NULL)", [saEmail, await bcrypt.hash(PW, 8)]);
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  sa = await login(saEmail);
  for (const n of [1, 2, 3]) E.push(await creerEcole(n));
  // les comptes de démonstration réels sont mis de côté le temps des tests, puis restaurés
  saved = (await db.qa('SELECT groupe, role, user_id FROM demo_accounts')).rows;
  demoSaved = true;
  await db.qa('DELETE FROM demo_accounts');
  for (const s of E) for (const role of ROLES) {
    const u = (await db.qa('SELECT id FROM users WHERE email=$1', [s.mails[role]])).rows[0];
    await db.qa('INSERT INTO demo_accounts(groupe,role,user_id) VALUES ($1,$2,$3)', [s.n, role, u.id]);
  }
});
test.after(async () => {
  if (demoSaved) await db.qa('DELETE FROM demo_accounts');
  for (const r of saved) await db.qa('INSERT INTO demo_accounts(groupe,role,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [r.groupe, r.role, r.user_id]).catch(() => {});
  const ids = E.map((s) => s.id);
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name NOT IN ('schools','users')")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) { for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {}); await db.qa('DELETE FROM users WHERE school_id = ANY($1)', [ids]).catch(() => {}); }
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email LIKE $1', [`%${stamp}@saas.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// ====================== Comptes de démonstration ======================
test('démo : liste des boutons = 3 écoles × 5 rôles, sans aucun mot de passe', async () => {
  const r = await must(null, 'GET', '/api/demo/accounts');
  assert.equal(r.demo, true); assert.deepEqual(r.groupes.map((g) => g.groupe), [1, 2, 3]);
  for (const g of r.groupes) assert.deepEqual([...g.roles].sort(), [...ROLES].sort());
  assert.ok(!/pass|mdp|secret|hash/i.test(JSON.stringify(r)), 'aucun secret dans la liste');
});

test('démo : les 15 comptes (3 écoles × 5 rôles) se connectent d\'un clic, avec le bon rôle, la bonne école et sans mot de passe dans la réponse', async () => {
  for (const s of E) for (const role of ROLES) {
    const r = await call(null, 'POST', '/api/demo/login', { groupe: s.n, role });
    assert.equal(r.status, 200, `École ${s.n} ${role} : ${r.text}`);
    assert.equal(r.data.user.role, role); assert.equal(r.data.user.school.id, s.id); assert.equal(r.data.user.email, s.mails[role]);
    assert.ok(!/"password(_hash)?"|hash/i.test(r.text), 'aucun mot de passe/hachage renvoyé');
    const me = await must(r.data.token, 'GET', '/api/auth/me'); assert.equal(me.role, role); assert.equal(me.school.id, s.id);
  }
});

test('démo : rôles et permissions respectés (RBAC) et isolation entre écoles', async () => {
  const tok = async (g, role) => (await must(null, 'POST', '/api/demo/login', { groupe: g, role })).token;
  const [adm1, par1, ele1, ens1, cpt1] = await Promise.all([tok(1, 'admin'), tok(1, 'parent'), tok(1, 'eleve'), tok(1, 'enseignant'), tok(1, 'comptable')]);
  // pas d'accès à l'espace propriétaire, quel que soit le rôle
  for (const t of [adm1, par1, ele1, ens1, cpt1]) assert.equal((await call(t, 'GET', '/api/saas/dashboard')).status, 403);
  // un parent ne crée pas d'élève ; un élève ne voit pas les paiements ; l'admin voit son école
  assert.equal((await call(par1, 'POST', '/api/eleves', { nom: 'X', prenom: 'Y' })).status, 403);
  assert.equal((await call(ele1, 'GET', '/api/paiements/impayes')).status, 403); assert.equal((await call(par1, 'GET', '/api/paiements/impayes')).status, 403); assert.equal((await call(cpt1, 'GET', '/api/paiements/impayes')).status, 200);
  assert.equal((await must(adm1, 'GET', '/api/eleves')).length, 1);
  // isolation : l'admin de l'école 1 ne voit ni ne lit les élèves de l'école 2
  assert.equal((await call(adm1, 'GET', `/api/eleves/${E[1].eleveId}`)).status, 404);
  assert.ok(!(await must(adm1, 'GET', '/api/eleves')).some((e) => e.id === E[1].eleveId));
  assert.ok(!(await must(adm1, 'GET', '/api/users')).some((u) => u.email === E[1].mails.admin));
  assert.equal((await call(adm1, 'GET', `/api/files/x`)).status, 404);
});

test('démo : refus d\'un groupe/rôle inconnu, du super-administrateur, d\'une école suspendue ; désactivable par configuration', async () => {
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 4, role: 'admin' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 1, role: 'superadmin' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 1 })).status, 400);
  await must(sa, 'PUT', `/api/saas/schools/${E[2].id}`, { status: 'suspended' });
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 3, role: 'admin' })).status, 403);
  assert.ok(!(await must(null, 'GET', '/api/demo/accounts')).groupes.some((g) => g.groupe === 3), 'école suspendue : boutons masqués');
  await must(sa, 'PUT', `/api/saas/schools/${E[2].id}`, { status: 'active' });
  // compte désactivé
  await db.qa("UPDATE users SET actif=FALSE WHERE email=$1", [E[0].mails.parent]);
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 1, role: 'parent' })).status, 404);
  await db.qa("UPDATE users SET actif=TRUE WHERE email=$1", [E[0].mails.parent]);
  config.demoLogin = false;
  try { assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 1, role: 'admin' })).status, 404); assert.equal((await call(null, 'GET', '/api/demo/accounts')).status, 404); }
  finally { config.demoLogin = true; }
  assert.equal((await call(null, 'POST', '/api/demo/login', { groupe: 1, role: 'admin' })).status, 200);
});

// ====================== Tableau de bord super-admin ======================
test('dashboard : totaux, actives/inactives et répartition par rôle et par école = données réelles de la base', async () => {
  const d = await must(sa, 'GET', '/api/saas/dashboard');
  const sql = async (q, p) => (await db.qa(q, p)).rows;
  const nbEcoles = (await sql('SELECT COUNT(*)::int n FROM schools'))[0].n;
  const nbUsers = (await sql("SELECT COUNT(*)::int n FROM users WHERE deleted_at IS NULL AND school_id IS NOT NULL"))[0].n;
  assert.equal(d.totaux.ecoles, nbEcoles); assert.equal(d.totaux.utilisateurs, nbUsers);
  assert.equal(d.totaux.ecoles_actives + d.totaux.ecoles_inactives, nbEcoles);
  for (const r of d.roles) assert.equal(r.n, (await sql("SELECT COUNT(*)::int n FROM users WHERE deleted_at IS NULL AND school_id IS NOT NULL AND role=$1", [r.role]))[0].n, r.role);
  assert.equal(d.roles.reduce((t, r) => t + r.n, 0), nbUsers);
  for (const s of E) {
    const l = d.ecoles.find((x) => x.id === s.id); assert.ok(l);
    for (const role of ['admin', 'comptable', 'enseignant', 'parent', 'eleve']) assert.equal(l.par_role[role], (await sql("SELECT COUNT(*)::int n FROM users WHERE school_id=$1 AND deleted_at IS NULL AND role=$2", [s.id, role]))[0].n, `${s.slug} ${role}`);
    assert.equal(l.utilisateurs, Object.values(l.par_role).reduce((t, n) => t + n, 0));
  }
  // dynamique : suspendre une école la fait passer en « inactive »
  await must(sa, 'PUT', `/api/saas/schools/${E[0].id}`, { status: 'suspended' });
  const d2 = await must(sa, 'GET', '/api/saas/dashboard');
  assert.equal(d2.totaux.ecoles_inactives, d.totaux.ecoles_inactives + 1); assert.equal(d2.totaux.ecoles_actives, d.totaux.ecoles_actives - 1);
  assert.equal(d2.totaux.dont_suspendues, d.totaux.dont_suspendues + 1);
  await must(sa, 'PUT', `/api/saas/schools/${E[0].id}`, { status: 'active' });
  // abonnement expiré = inactive
  await db.qa("UPDATE schools SET subscription_end = CURRENT_DATE - 3 WHERE id=$1", [E[1].id]);
  const d3 = await must(sa, 'GET', '/api/saas/dashboard'); assert.equal(d3.totaux.dont_expirees, d.totaux.dont_expirees + 1);
  await must(sa, 'PUT', `/api/saas/schools/${E[1].id}`, { subscription_end: null });
  // accès réservé
  assert.equal((await call(E[0].admin, 'GET', '/api/saas/dashboard')).status, 403); assert.equal((await call(null, 'GET', '/api/saas/dashboard')).status, 401);
});

test('écoles : début et fin d\'abonnement enregistrés, cohérence contrôlée, +1 mois / +1 an (PUT inchangé) toujours possibles', async () => {
  const s = E[1];
  const liste = await must(sa, 'GET', '/api/saas/schools'); const l = liste.find((x) => x.id === s.id);
  assert.ok(l.subscription_start, 'début d\'abonnement présent'); assert.ok('nb_utilisateurs' in l && 'plan' in l && 'status' in l);
  await must(sa, 'PUT', `/api/saas/schools/${s.id}`, { subscription_start: '2026-01-01', subscription_end: '2027-01-01' });
  const r = (await db.qa('SELECT subscription_start::text a, subscription_end::text b FROM schools WHERE id=$1', [s.id])).rows[0]; assert.deepEqual([r.a, r.b], ['2026-01-01', '2027-01-01']);
  assert.equal((await call(sa, 'PUT', `/api/saas/schools/${s.id}`, { subscription_end: '2025-12-31' })).status, 400, 'fin avant début refusée');
  assert.equal((await call(sa, 'PUT', `/api/saas/schools/${s.id}`, { subscription_start: 'pas-une-date' })).status, 400);
  // +1 mois : mêmes champs qu'avant (status + subscription_end)
  await must(sa, 'PUT', `/api/saas/schools/${s.id}`, { status: 'active', subscription_end: '2027-02-01' });
  const neuve = await must(sa, 'POST', '/api/saas/schools', { nom: `Abo ${stamp}`, ville: 'Sfax', plan: 'basic', status: 'trial', subscription_start: '2026-11-01', subscription_end: '2027-11-01', admin: { email: `abo-${stamp}@sd.tn`, nom: 'Dir', prenom: 'Ecole', password: PW } });
  E.push({ id: neuve.id });
  assert.equal(String(neuve.subscription_start).slice(0, 10), '2026-11-01');
  // fin d'abonnement avant le début à la création : refusée
  assert.equal((await call(sa, 'POST', '/api/saas/schools', { nom: `Abo2 ${stamp}`, ville: 'Sfax', subscription_start: '2026-11-20', subscription_end: '2026-11-12', admin: { email: `abo2-${stamp}@sd.tn`, nom: 'Dir', prenom: 'Ecole', password: PW } })).status, 400);
});

// ====================== Profil ======================
test('profil : consulter, modifier nom/prénom/téléphone, e-mail (mot de passe requis), mot de passe, photo — tout est enregistré en base', async () => {
  const p = await must(sa, 'GET', '/api/saas/profil'); assert.equal(p.email, saEmail);
  const m = await must(sa, 'PUT', '/api/saas/profil', { nom: 'Ben Ali', prenom: 'Sofiène', telephone: '22 333 444' });
  assert.deepEqual([m.nom, m.prenom, m.telephone], ['Ben Ali', 'Sofiène', '22333444']);
  const bd = (await db.qa('SELECT nom, prenom, telephone FROM users WHERE email=$1', [saEmail])).rows[0]; assert.deepEqual(bd, { nom: 'Ben Ali', prenom: 'Sofiène', telephone: '22333444' });
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', { telephone: '123' })).status, 400);
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', { nom: '' })).status, 400);
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', {})).status, 400);
  // e-mail : mot de passe actuel exigé, doublon refusé
  const nouveau = `sa2-sd-${stamp}@saas.test`;
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', { email: nouveau })).status, 400);
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', { email: nouveau, mot_de_passe_actuel: 'mauvais' })).status, 400);
  assert.equal((await call(sa, 'PUT', '/api/saas/profil', { email: E[0].mails.admin, mot_de_passe_actuel: PW })).status, 409);
  await must(sa, 'PUT', '/api/saas/profil', { email: nouveau, mot_de_passe_actuel: PW });
  assert.equal((await must(sa, 'GET', '/api/auth/me')).email, nouveau); assert.equal((await must(sa, 'GET', '/api/auth/me')).telephone, '22333444');
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: saEmail, password: PW })).status, 401, 'ancien e-mail inutilisable');
  saEmail = nouveau; sa = await login(nouveau);
  // mot de passe
  assert.equal((await call(sa, 'POST', '/api/auth/change-password', { ancien: 'faux', nouveau: 'Nouveau@2026x', confirmation: 'Nouveau@2026x' })).status, 400);
  await must(sa, 'POST', '/api/auth/change-password', { ancien: PW, nouveau: 'Nouveau@2026x', confirmation: 'Nouveau@2026x' });
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: saEmail, password: PW })).status, 401);
  sa = await login(saEmail, 'Nouveau@2026x');
  // photo : envoi, lecture authentifiée, refus d'un faux fichier, remplacement, suppression
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('photo', new Blob([png], { type: 'image/png' }), 'a.png');
  const up = await call(sa, 'POST', '/api/saas/profil/photo', null, fd); assert.equal(up.status, 200, up.text); assert.match(up.data.photo, /^\/api\/files\/[a-f0-9]{32}\.png$/);
  const img = await fetch(base + up.data.photo, { headers: { Authorization: `Bearer ${sa}` } }); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(base + up.data.photo)).status, 401, 'photo non publique');
  assert.equal((await fetch(base + up.data.photo, { headers: { Authorization: `Bearer ${E[0].admin}` } })).status, 404, 'un compte d\'école ne lit pas la photo');
  const bad = new FormData(); bad.append('photo', new Blob(['<html>'], { type: 'image/png' }), 'a.png'); assert.equal((await call(sa, 'POST', '/api/saas/profil/photo', null, bad)).status, 400);
  const bad2 = new FormData(); bad2.append('photo', new Blob(['x'], { type: 'text/html' }), 'a.html'); assert.equal((await call(sa, 'POST', '/api/saas/profil/photo', null, bad2)).status, 400);
  const fd2 = new FormData(); fd2.append('photo', new Blob([png], { type: 'image/png' }), 'b.png');
  const rep = await call(sa, 'POST', '/api/saas/profil/photo', null, fd2); assert.equal(rep.status, 200); assert.notEqual(rep.data.photo, up.data.photo);
  assert.equal((await fetch(base + up.data.photo, { headers: { Authorization: `Bearer ${sa}` } })).status, 404, 'ancienne photo supprimée');
  assert.equal((await must(sa, 'GET', '/api/auth/me')).photo, rep.data.photo);
  assert.equal((await must(sa, 'DELETE', '/api/saas/profil/photo')).photo, null);
  // un compte d'école n'a pas accès à ces routes
  assert.equal((await call(E[0].admin, 'PUT', '/api/saas/profil', { nom: 'Pirate' })).status, 403);
});

// ====================== Finances ======================
test('finances : totaux = données réelles ; filtres école / année / mois cohérents ; paiement enregistré visible aussitôt', async () => {
  const s = E[0]; const an = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' }).slice(0, 4));
  await must(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: 1000, jour_echeance: 5, date_debut: `${an}-01-01` });
  const st = await must(sa, 'GET', `/api/saas/finance/stats?annee=${an}&ecole_id=${s.id}`);
  assert.equal(st.totaux.loyer_mensuel_total, 1000); assert.equal(st.totaux.encaisse, 0);
  assert.ok(st.totaux.impaye >= 0 && st.echeances.length >= 12);
  const retard = st.echeances.find((e) => e.statut === 'en_retard');
  if (retard) {
    await must(sa, 'POST', `/api/saas/echeances/${retard.id}/encaissements`, { montant: 400, mode: 'especes' });
    const st2 = await must(sa, 'GET', `/api/saas/finance/stats?annee=${an}&ecole_id=${s.id}`);
    assert.equal(st2.totaux.encaisse, 400); assert.equal(st2.totaux.impaye, st.totaux.impaye - 400);
    const sqlSum = (await db.qa('SELECT COALESCE(SUM(montant),0)::float s FROM loyer_encaissements WHERE school_id=$1', [s.id])).rows[0].s; assert.equal(sqlSum, 400);
    const mois = Number(retard.periode.slice(5, 7)); const sm = await must(sa, 'GET', `/api/saas/finance/stats?annee=${an}&ecole_id=${s.id}&mois=${mois}`);
    assert.equal(sm.totaux.prevu, 1000); assert.equal(sm.totaux.impaye, 600);
    assert.equal((await call(sa, 'POST', `/api/saas/echeances/${retard.id}/encaissements`, { montant: 700, mode: 'especes' })).status, 400, 'trop-perçu refusé');
  }
  const autre = await must(sa, 'GET', `/api/saas/finance/stats?annee=${an}&ecole_id=${E[2].id}`); assert.equal(autre.totaux.prevu, 0, 'autre école sans contrat : rien');
});

// ====================== Emploi du temps : conflits, ajout / modification / suppression ======================
const cr = (s, o) => ({ classe_id: s.classe, matiere_id: s.matiere, enseignant_id: s.ids.enseignant, salle_id: s.salle1, jour: 2, heure_debut: '09:00', heure_fin: '10:00', ...o });

test('EDT : même salle (classes différentes) ou même enseignant (classes différentes) en chevauchement = refusé avec message ; bout à bout accepté', async () => {
  const s = E[0];
  const a = await must(s.admin, 'POST', '/api/creneaux', cr(s, {}));
  // même salle, autre classe, autre enseignant, horaire qui chevauche
  const r1 = await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, enseignant_id: s.ens2, heure_debut: '09:30', heure_fin: '10:30' }));
  assert.equal(r1.status, 409, r1.text); assert.equal(r1.data.code, 'conflit_edt'); assert.match(r1.data.error, /salle « Salle 1 » est déjà réservée/); assert.ok(r1.data.conflits.some((c) => c.type === 'salle'));
  // même enseignant, autre classe, autre salle
  const r2 = await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, salle_id: s.salle2, heure_debut: '08:30', heure_fin: '09:30' }));
  assert.equal(r2.status, 409, r2.text); assert.match(r2.data.error, /enseignant .* déjà affecté/); assert.ok(r2.data.conflits.some((c) => c.type === 'enseignant'));
  // autre jour : accepté ; bout à bout : accepté
  await must(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, jour: 3, heure_debut: '09:30', heure_fin: '10:30' }));
  const b = await must(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, salle_id: s.salle1, enseignant_id: s.ens2, heure_debut: '10:00', heure_fin: '11:00' }));
  s.a = a.id; s.b = b.id;
});

test('EDT : modification (la séance modifiée est exclue de la vérification) et suppression avec libération du créneau', async () => {
  const s = E[0];
  // se déplacer sur son propre créneau (chevauche l'ancien de la même séance) : accepté
  await must(s.admin, 'PUT', `/api/creneaux/${s.a}`, { heure_debut: '09:15', heure_fin: '10:00' });
  // modification qui crée un conflit : refusée, séance inchangée
  const r = await call(s.admin, 'PUT', `/api/creneaux/${s.a}`, { heure_fin: '10:30' });
  assert.equal(r.status, 409, r.text); assert.match(r.data.error, /Conflit d'emploi du temps/);
  const apres = (await db.qa('SELECT heure_fin::text h FROM creneaux WHERE id=$1', [s.a])).rows[0]; assert.equal(apres.h.slice(0, 5), '10:00');
  // changement de salle vers une salle occupée : refusé ; vers une salle libre : accepté
  assert.equal((await call(s.admin, 'PUT', `/api/creneaux/${s.b}`, { heure_debut: '09:30', heure_fin: '10:30' })).status, 409);
  await must(s.admin, 'PUT', `/api/creneaux/${s.b}`, { salle_id: s.salle2, heure_debut: '09:30', heure_fin: '10:30', enseignant_id: s.ens2 });
  // suppression : le créneau disparaît, la salle est de nouveau libre
  assert.equal((await call(s.admin, 'DELETE', `/api/creneaux/${s.a}`)).status, 200);
  assert.ok(!(await must(s.admin, 'GET', '/api/creneaux')).some((c) => c.id === s.a));
  await must(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, enseignant_id: s.ens2, salle_id: s.salle1, heure_debut: '09:00', heure_fin: '09:30', jour: 2 }));
  assert.equal((await call(s.admin, 'DELETE', `/api/creneaux/${s.a}`)).status, 404, 'déjà supprimé');
  // seuls admin et enseignant (ses propres créneaux) écrivent
  const par = await login(s.mails.parent); assert.equal((await call(par, 'POST', '/api/creneaux', cr(s, {}))).status, 403);
  assert.equal((await call(par, 'DELETE', `/api/creneaux/${s.b}`)).status, 403);
});

test('EDT : isolation entre écoles — une même salle/horaire/enseignant dans une autre école n\'est pas un conflit', async () => {
  const s = E[1];
  await must(s.admin, 'POST', '/api/creneaux', cr(s, {}));
  assert.equal((await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classe2, enseignant_id: s.ens2 }))).status, 409);
  const autre = E[0]; const n = (await must(autre.admin, 'GET', '/api/creneaux')).length;
  assert.ok(n >= 1); assert.ok(!(await must(autre.admin, 'GET', '/api/creneaux')).some((c) => c.classe_id === s.classe));
});

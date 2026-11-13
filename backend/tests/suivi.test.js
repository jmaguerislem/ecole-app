// Tests : retards d'arrivée (saisie + appel), absences / remplacements des enseignants, réclamations des parents.
// Droits par rôle, validations, doublons, notifications et isolation entre écoles.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1'; const stamp = Date.now().toString(36);
const CUR = config.anneeCourante;
let base; let server; let sup; const ids = []; const X = {}; const T = {};
async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const must = async (token, method, url, body) => { const r = await call(token, method, url, body); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const login = async (email) => (await must(null, 'POST', '/api/auth/login', { email, password: PW })).token;
const ins = async (schoolId, table, o) => {
  const k = Object.keys(o);
  const r = await db.qa(`INSERT INTO ${table}(${k.join(',')},school_id) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')},$${k.length + 1}) RETURNING *`, [...k.map((c) => o[c]), schoolId]);
  return r.rows[0].id;
};
const iso = (d) => d.toISOString().slice(0, 10);
const ouvre = (joursAvant) => { const d = new Date(Date.now() - joursAvant * 86400000); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return iso(d); }; // jour de classe (pas un dimanche)
const dimanche = () => { const d = new Date(); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1); return iso(d); };
const notifs = async (userId, type) => (await db.qa('SELECT * FROM notifications WHERE user_id=$1 AND type=$2', [userId, type])).rows;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@suivi.test`, await bcrypt.hash(PW, 4)]);
  sup = await login(`sa-${stamp}@suivi.test`);
  const hash = await bcrypt.hash(PW, 4);
  for (const k of ['a', 'b']) {
    const r = await must(sup, 'POST', '/api/saas/schools', { nom: `Suivi${k} ${stamp}`, ville: `V${k}`, status: 'active', plan: 'premium', admin: { email: `dir-${k}-${stamp}@suivi.test`, password: PW } });
    ids.push(r.id); T[k] = { id: r.id };
  }
  const sA = T.a.id; const sB = T.b.id;
  T.a.admin = await login(`dir-a-${stamp}@suivi.test`); T.b.admin = await login(`dir-b-${stamp}@suivi.test`);
  X.adminA = (await db.qa('SELECT id FROM users WHERE lower(email)=lower($1)', [`dir-a-${stamp}@suivi.test`])).rows[0].id;
  const user = (s, role, nom, extra = {}) => ins(s, 'users', { email: `${nom}-${stamp}@suivi.test`.toLowerCase(), password_hash: hash, role, nom, prenom: 'Bi', ...extra });
  X.ens1 = await user(sA, 'enseignant', 'ens1'); X.ens2 = await user(sA, 'enseignant', 'ens2'); X.ens3 = await user(sA, 'enseignant', 'ens3'); X.ensB = await user(sB, 'enseignant', 'ensb');
  X.p1 = await user(sA, 'parent', 'p1'); X.p2 = await user(sA, 'parent', 'p2'); X.pB = await user(sB, 'parent', 'pb');
  // Classe C1 (titulaire ens1) avec 2 élèves, classe C2 (titulaire ens2) avec 1 élève
  X.c1 = await ins(sA, 'classes', { niveau: '1ère année', section: 'A', capacite: 25, annee_scolaire: CUR, titulaire_id: X.ens1 });
  X.c2 = await ins(sA, 'classes', { niveau: '2ème année', section: 'A', capacite: 25, annee_scolaire: CUR, titulaire_id: X.ens2 });
  X.cB = await ins(sB, 'classes', { niveau: '1ère année', section: 'A', capacite: 25, annee_scolaire: CUR });
  X.e1 = await ins(sA, 'eleves', { nom: 'Un', prenom: 'Eleve', classe_id: X.c1, annee_entree: CUR, statut: 'actif' }); X.e2 = await ins(sA, 'eleves', { nom: 'Deux', prenom: 'Eleve', classe_id: X.c1, annee_entree: CUR, statut: 'actif' });
  X.e3 = await ins(sA, 'eleves', { nom: 'Trois', prenom: 'Eleve', classe_id: X.c2, annee_entree: CUR, statut: 'actif' }); X.eB = await ins(sB, 'eleves', { nom: 'Autre', prenom: 'Eleve', classe_id: X.cB, annee_entree: CUR, statut: 'actif' });
  await ins(sA, 'eleve_parents', { eleve_id: X.e1, parent_id: X.p1, lien: 'mere' }); await ins(sA, 'eleve_parents', { eleve_id: X.e3, parent_id: X.p2, lien: 'pere' });
  for (const k of ['ens1', 'ens2', 'ens3', 'p1', 'p2']) T[k] = await login(`${k}-${stamp}@suivi.test`);
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@suivi.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// ======================= Retards d'arrivée =======================
test('retards : un enseignant saisit dans SES classes, les parents voient ceux de leur enfant', async () => {
  const d = ouvre(1);
  const r = await must(T.ens1, 'POST', '/api/retards', { eleve_id: X.e1, date_retard: d, minutes: 15, motif: 'Bus en retard' });
  assert.equal(r.minutes, 15); assert.equal(r.justifie, false); assert.equal(r.eleve_nom, 'Un Eleve');
  assert.equal((await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e3, date_retard: d, minutes: 5 })).status, 403, 'élève d’une autre classe');
  assert.equal((await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.eB, date_retard: d, minutes: 5 })).status, 403, 'élève d’une autre école');
  assert.equal((await call(T.p1, 'POST', '/api/retards', { eleve_id: X.e1, date_retard: d, minutes: 5 })).status, 403, 'un parent ne saisit pas');
  await must(T.ens2, 'POST', '/api/retards', { eleve_id: X.e3, date_retard: d, minutes: 8 });
  const p1 = await must(T.p1, 'GET', '/api/retards'); assert.deepEqual(p1.map((x) => x.eleve_id), [X.e1], 'le parent 1 ne voit que son enfant');
  const p2 = await must(T.p2, 'GET', '/api/retards'); assert.deepEqual(p2.map((x) => x.eleve_id), [X.e3]);
  assert.equal((await call(T.p2, 'GET', `/api/retards/${r.id}`)).status, 404, 'le retard d’un autre enfant est introuvable');
  assert.equal((await must(T.ens1, 'GET', '/api/retards')).length, 1, 'l’enseignant ne voit que ses classes');
  assert.equal((await must(T.a.admin, 'GET', '/api/retards')).length, 2);
  assert.equal((await must(T.b.admin, 'GET', '/api/retards')).length, 0, 'isolation entre écoles');
});

test('retards : parent notifié, doublon, minutes, dates et justification', async () => {
  await attendre(300);
  const n = await notifs(X.p1, 'retard'); assert.equal(n.length, 1); assert.ok(n[0].corps.includes('15 min') && n[0].titre.includes('Eleve Un'));
  const d = ouvre(1);
  assert.equal((await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e1, date_retard: d, minutes: 5 })).status, 409, 'un seul retard par élève et par jour');
  for (const m of [0, 241, 'abc', 2.5, -3]) assert.equal((await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e2, date_retard: ouvre(2), minutes: m })).status, 400, `minutes=${m}`);
  const futur = await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e2, date_retard: iso(new Date(Date.now() + 3 * 86400000)), minutes: 5 });
  assert.equal(futur.status, 400); assert.ok(futur.data.error.includes('retard') && !futur.data.error.includes('absence'), `message adapté : ${futur.data.error}`);
  const dim = await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e2, date_retard: dimanche(), minutes: 5 }); assert.equal(dim.status, 400); assert.ok(dim.data.error.includes('dimanche'));
  // absent toute la journée → pas de retard possible ce jour-là
  await ins(T.a.id, 'absences', { eleve_id: X.e2, date_absence: ouvre(3), periode: 'journee', annee_scolaire: CUR });
  assert.equal((await call(T.ens1, 'POST', '/api/retards', { eleve_id: X.e2, date_retard: ouvre(3), minutes: 5 })).status, 409);
  // justification : réservée à la direction
  const r = (await must(T.ens1, 'GET', '/api/retards'))[0];
  assert.equal((await call(T.ens1, 'PUT', `/api/retards/${r.id}`, { justifie: true })).status, 403);
  assert.equal((await must(T.a.admin, 'PUT', `/api/retards/${r.id}`, { justifie: true })).justifie, true);
  assert.equal((await call(T.ens1, 'PUT', `/api/retards/${r.id}`, { minutes: 20 })).status, 403, 'retard justifié : seule la direction le modifie');
  assert.equal((await call(T.ens1, 'DELETE', `/api/retards/${r.id}`)).status, 403);
});

test('appel : l’enseignant note les retards en même temps que les absents ; compatible avec l’ancien format', async () => {
  const date = ouvre(5); const put = (body) => call(T.ens1, 'PUT', '/api/absences/appel', { classe_id: X.c1, date_absence: date, ...body });
  // ancien format (sans `retards`) : fonctionne et ne touche pas aux retards
  assert.equal((await put({ absents: [{ eleve_id: X.e2 }] })).status, 200);
  let g = await must(T.ens1, 'GET', `/api/absences/appel?classe_id=${X.c1}&date=${date}`);
  assert.equal(g.eleves.find((e) => e.eleve_id === X.e2).absence_id !== null, true); assert.equal(g.eleves.find((e) => e.eleve_id === X.e1).retard_minutes, null);
  // nouveau format : un élève en retard
  let r = await put({ absents: [{ eleve_id: X.e2 }], retards: [{ eleve_id: X.e1, minutes: 12, motif: 'Médecin' }] }); assert.equal(r.status, 200); assert.equal(r.data.retards, 1);
  g = await must(T.ens1, 'GET', `/api/absences/appel?classe_id=${X.c1}&date=${date}`);
  assert.deepEqual([g.eleves.find((e) => e.eleve_id === X.e1).retard_minutes, g.eleves.find((e) => e.eleve_id === X.e1).retard_motif], [12, 'Médecin']);
  // un élève absent toute la journée ne peut pas être en retard ; élève d'une autre classe refusé ; minutes invalides refusées
  assert.equal((await put({ absents: [{ eleve_id: X.e2 }], retards: [{ eleve_id: X.e2, minutes: 5 }] })).status, 400);
  assert.equal((await put({ absents: [], retards: [{ eleve_id: X.e3, minutes: 5 }] })).status, 400);
  assert.equal((await put({ absents: [{ eleve_id: X.e2 }], retards: [{ eleve_id: X.e1, minutes: 0 }] })).status, 400);
  // sans `retards` : le retard existant est conservé ; avec une liste vide : il est supprimé
  assert.equal((await put({ absents: [{ eleve_id: X.e2 }] })).status, 200);
  assert.equal((await must(T.ens1, 'GET', `/api/absences/appel?classe_id=${X.c1}&date=${date}`)).eleves.find((e) => e.eleve_id === X.e1).retard_minutes, 12);
  r = await put({ absents: [{ eleve_id: X.e2 }], retards: [] }); assert.equal(r.data.supprimes, 1);
  assert.equal((await must(T.ens1, 'GET', `/api/absences/appel?classe_id=${X.c1}&date=${date}`)).eleves.find((e) => e.eleve_id === X.e1).retard_minutes, null);
  assert.equal((await call(T.ens2, 'PUT', '/api/absences/appel', { classe_id: X.c1, date_absence: date, absents: [], retards: [] })).status, 403, 'pas sa classe');
});

// ======================= Absences et remplacements des enseignants =======================
test('absences enseignants : la direction saisit, le remplaçant est notifié, un enseignant ne voit que les siennes', async () => {
  const d = ouvre(10);
  const a = await must(T.a.admin, 'POST', '/api/absences-enseignants', { enseignant_id: X.ens1, date_absence: d, periode: 'journee', motif: 'Maladie', justifiee: true, remplacant_id: X.ens2 });
  assert.equal(a.enseignant_nom, 'Bi ens1'); assert.equal(a.remplacant_nom, 'Bi ens2'); assert.equal(a.justifiee, true);
  await attendre(300);
  const n = await notifs(X.ens2, 'remplacement'); assert.equal(n.length, 1); assert.ok(n[0].corps.includes('Bi ens1'));
  assert.equal((await call(T.ens1, 'POST', '/api/absences-enseignants', { enseignant_id: X.ens1, date_absence: ouvre(11) })).status, 403, 'un enseignant ne déclare pas');
  assert.equal((await call(T.p1, 'GET', '/api/absences-enseignants')).status, 403, 'les parents n’y ont pas accès');
  assert.equal((await must(T.ens1, 'GET', '/api/absences-enseignants')).length, 1, 'sa propre absence');
  assert.equal((await must(T.ens2, 'GET', '/api/absences-enseignants')).length, 1, 'le remplacement qui lui est confié');
  assert.equal((await must(T.ens3, 'GET', '/api/absences-enseignants')).length, 0, 'rien pour un autre enseignant');
  assert.equal((await must(T.b.admin, 'GET', '/api/absences-enseignants')).length, 0, 'isolation entre écoles');
  // le remplaçant peut être désigné après coup (modification) et il est alors notifié
  const b = await must(T.a.admin, 'POST', '/api/absences-enseignants', { enseignant_id: X.ens3, date_absence: ouvre(12) });
  assert.equal(b.remplacant_id, null);
  const m = await must(T.a.admin, 'PUT', `/api/absences-enseignants/${b.id}`, { remplacant_id: X.ens2 }); assert.equal(m.remplacant_nom, 'Bi ens2');
  await attendre(300); assert.equal((await notifs(X.ens2, 'remplacement')).length, 2);
});

test('absences enseignants : validations (doublon, remplaçant, dates, rôles, école)', async () => {
  const post = (b) => call(T.a.admin, 'POST', '/api/absences-enseignants', b);
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: ouvre(10) })).status, 409, 'une absence par enseignant et par jour');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: ouvre(20), remplacant_id: X.ens1 })).status, 400, 'ne peut pas se remplacer lui-même');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: ouvre(20), remplacant_id: X.p1 })).status, 400, 'le remplaçant doit être un enseignant');
  assert.equal((await post({ enseignant_id: X.p1, date_absence: ouvre(20) })).status, 400, 'l’absent doit être un enseignant');
  assert.equal((await post({ enseignant_id: X.ensB, date_absence: ouvre(20) })).status, 400, 'enseignant d’une autre école');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: ouvre(20), remplacant_id: X.ensB })).status, 400, 'remplaçant d’une autre école');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: dimanche() })).status, 400, 'dimanche');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: iso(new Date(Date.now() + 90 * 86400000)) })).status, 400, 'trop loin dans le futur');
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: ouvre(20), periode: 'nuit' })).status, 400, 'période invalide');
  // le remplaçant ne peut pas être lui-même absent ce jour-là
  assert.equal((await post({ enseignant_id: X.ens3, date_absence: ouvre(10), remplacant_id: X.ens1 })).status, 409);
  // absence à venir (congé prévu) : acceptée
  const futur = new Date(Date.now() + 5 * 86400000); if (futur.getUTCDay() === 0) futur.setUTCDate(futur.getUTCDate() + 1);
  assert.equal((await post({ enseignant_id: X.ens1, date_absence: iso(futur), periode: 'matin' })).status, 201);
});

// ======================= Réclamations des parents =======================
test('réclamations : le parent dépose (statut imposé), la direction est notifiée, chacun ne voit que les siennes', async () => {
  const r = await must(T.p1, 'POST', '/api/reclamations', { eleve_id: X.e1, categorie: 'pedagogique', objet: '  Notes   de mon enfant ', description: 'Je souhaite comprendre les notes du dernier contrôle.',
    parent_id: X.p2, statut: 'resolue', reponse: 'Tout est réglé' }); // tentatives de triche : autre parent, statut et réponse imposés
  assert.deepEqual([r.parent_id, r.statut, r.reponse, r.objet, r.resolved_at, r.traite_par], [X.p1, 'ouverte', null, 'Notes de mon enfant', null, null]);
  assert.equal(r.parent_nom, 'Bi p1'); assert.equal(r.eleve_nom, 'Eleve Un');
  await attendre(300); const n = await notifs(X.adminA, 'reclamation'); assert.equal(n.length, 1); assert.ok(n[0].corps.includes('Notes de mon enfant'));
  await must(T.p2, 'POST', '/api/reclamations', { categorie: 'financier', objet: 'Facture', description: 'Il y a une erreur sur la facture de février.' }); // sans enfant : accepté
  assert.deepEqual((await must(T.p1, 'GET', '/api/reclamations')).map((x) => x.id), [r.id]);
  assert.equal((await must(T.p2, 'GET', '/api/reclamations')).length, 1);
  assert.equal((await call(T.p2, 'GET', `/api/reclamations/${r.id}`)).status, 404);
  assert.equal((await must(T.a.admin, 'GET', '/api/reclamations')).length, 2);
  assert.equal((await must(T.a.admin, 'GET', '/api/reclamations?statut=ouverte')).length, 2);
  assert.equal((await must(T.b.admin, 'GET', '/api/reclamations')).length, 0, 'isolation entre écoles');
  X.rec = r.id;
});

test('réclamations : validations et droits du parent', async () => {
  const post = (b, t = T.p1) => call(t, 'POST', '/api/reclamations', { objet: 'Objet valide', description: 'Une description suffisamment longue.', ...b });
  assert.equal((await post({ eleve_id: X.e3 })).status, 403, 'pas son enfant');
  assert.equal((await post({ eleve_id: X.eB })).status, 403, 'enfant d’une autre école');
  assert.equal((await post({ categorie: 'inconnue' })).status, 400);
  assert.equal((await post({ description: 'court' })).status, 400);
  assert.equal((await post({ objet: 'ab' })).status, 400);
  assert.equal((await post({ objet: 'x'.repeat(151) })).status, 400);
  assert.equal((await post({ description: 'y'.repeat(2001) })).status, 400);
  assert.equal((await call(T.p1, 'PUT', `/api/reclamations/${X.rec}`, { objet: 'Modifié' })).status, 403, 'plus modifiable une fois envoyée');
  assert.equal((await call(T.p1, 'DELETE', `/api/reclamations/${X.rec}`)).status, 403, 'plus supprimable');
  assert.equal((await call(T.ens1, 'GET', '/api/reclamations')).status, 403, 'un enseignant n’y a pas accès');
});

test('réclamations : la direction traite (réponse obligatoire pour clore), le parent est notifié', async () => {
  const put = (b, t = T.a.admin) => call(t, 'PUT', `/api/reclamations/${X.rec}`, b);
  assert.equal((await put({ statut: 'en_cours' })).status, 200);
  await attendre(300); assert.equal((await notifs(X.p1, 'reclamation')).length, 1);
  assert.equal((await put({ statut: 'resolue' })).status, 400, 'réponse obligatoire pour résoudre');
  assert.equal((await put({ statut: 'bizarre' })).status, 400);
  const ok = await must(T.a.admin, 'PUT', `/api/reclamations/${X.rec}`, { statut: 'resolue', reponse: 'Nous avons revu les notes avec l’enseignant.', objet: 'Objet réécrit par la direction', parent_id: X.p2 });
  assert.deepEqual([ok.statut, ok.traite_par, ok.objet, ok.parent_id], ['resolue', X.adminA, 'Notes de mon enfant', X.p1], 'la direction ne réécrit pas la réclamation du parent');
  assert.ok(ok.resolved_at && ok.traite_par_nom); assert.equal(ok.reponse, 'Nous avons revu les notes avec l’enseignant.');
  await attendre(300); const n = await notifs(X.p1, 'reclamation'); assert.equal(n.length, 2); assert.ok(n.some((x) => x.corps.includes('résolue') && x.corps.includes('revu les notes')));
  const vue = await must(T.p1, 'GET', `/api/reclamations/${X.rec}`); assert.equal(vue.reponse, ok.reponse, 'le parent lit la réponse');
  const rouverte = await must(T.a.admin, 'PUT', `/api/reclamations/${X.rec}`, { statut: 'ouverte' }); assert.equal(rouverte.resolved_at, null, 'réouverte : plus de date de résolution');
  assert.equal((await call(T.b.admin, 'PUT', `/api/reclamations/${X.rec}`, { statut: 'en_cours' })).status, 404, 'une autre école ne peut pas la traiter');
});

test('les nouvelles tables sont isolées par école (Row Level Security)', async () => {
  const r = (await db.qa("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('retards','absences_enseignants','reclamations') ORDER BY 1")).rows;
  assert.deepEqual(r.map((x) => [x.relname, x.relrowsecurity]), [['absences_enseignants', true], ['reclamations', true], ['retards', true]]);
  const sans = (await db.qa('SELECT (SELECT COUNT(*) FROM retards WHERE school_id IS NULL) a, (SELECT COUNT(*) FROM reclamations WHERE school_id IS NULL) b, (SELECT COUNT(*) FROM absences_enseignants WHERE school_id IS NULL) c')).rows[0];
  assert.deepEqual([Number(sans.a), Number(sans.b), Number(sans.c)], [0, 0, 0]);
});

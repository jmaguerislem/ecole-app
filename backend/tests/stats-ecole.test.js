// Tests : statistiques d'UNE école (page « Statistiques de l'école » du directeur).
// Trois écoles fictives avec des données volontairement DIFFÉRENTES (A : riche, B : petite, C : vide) :
// chaque directeur doit voir exactement ses chiffres, jamais ceux d'une autre école, et les chiffres suivent la base en direct.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');
const { verifier } = require('../src/scripts/verifier-coherence-ecoles');

const PW = 'Test@2026x1'; const stamp = Date.now().toString(36);
let base; let server; let sup; const S = {}; const ids = [];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
const jourPasse = (n = 1) => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const dimanche = () => new Date(`${today()}T12:00:00Z`).getUTCDay() === 0;
const annee = Number(config.anneeCourante.slice(0, 4));
async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const must = async (token, method, url, body) => { const r = await call(token, method, url, body); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r.data; };
const login = async (email) => (await must(null, 'POST', '/api/auth/login', { email, password: PW })).token;
const stats = async (k) => (await must(S[k].admin, 'GET', '/api/stats/mon-ecole'));
const un = async (sql, p) => Number((await db.qa(sql, p)).rows[0].n);
const eleve = (token, prenom, extra = {}) => must(token, 'POST', '/api/eleves', { nom: 'Stat', prenom, date_naissance: '2018-05-05', sexe: 'M', password: PW, password_confirm: PW, statut: 'actif', ...extra });

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@se.test`, await bcrypt.hash(PW, 4)]);
  sup = await login(`sa-${stamp}@se.test`);
  for (const k of ['A', 'B', 'C']) {
    const r = await must(sup, 'POST', '/api/saas/schools', { nom: `Zeta${k} ${stamp}`, ville: `Ville${k}`, status: 'active', plan: 'standard', admin: { email: `dir-${k}-${stamp}@se.test`, password: PW } });
    S[k] = { id: r.id, nom: `Zeta${k} ${stamp}`, admin: await login(`dir-${k}-${stamp}@se.test`) }; ids.push(r.id);
  }
  // ---------- École A : riche ----------
  const A = S.A.admin;
  const c1 = (await must(A, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 20 })).id;
  const c2 = (await must(A, 'POST', '/api/classes', { niveau: '2ème année', section: 'A', capacite: 30 })).id;
  S.A.e = [];
  for (const [p, extra] of [['Amine', { classe_id: c1 }], ['Asma', { classe_id: c1, sexe: 'F' }], ['Adam', { classe_id: c2 }], ['Aya', { classe_id: c2, sexe: 'F' }], ['Anis', {}], ['Alaa', { classe_id: c1, statut: 'inactif' }]]) S.A.e.push((await eleve(A, p, extra)).id);
  for (const [n, role, mail] of [['Enseignante', 'enseignant', 'ens1'], ['Enseignant', 'enseignant', 'ens2'], ['Parente', 'parent', 'par1'], ['Parenta', 'parent', 'par2'], ['Parento', 'parent', 'par3'], ['Comptable', 'comptable', 'cpt1']])
    await must(A, 'POST', '/api/users', { nom: n, prenom: 'Test', email: `${mail}-a-${stamp}@se.test`, role, password: PW });
  await must(A, 'POST', '/api/tarifs', { libelle: 'Scolarité 1', type: 'scolarite', niveau: '1ère année', montant: 300 });
  await must(A, 'POST', '/api/paiements', { eleve_id: S.A.e[0], montant: 100, mode: 'especes' });
  await must(A, 'POST', '/api/paiements', { eleve_id: S.A.e[0], montant: 50, mode: 'virement', reference: `VIR-${stamp}` });
  await must(A, 'POST', '/api/paiements', { eleve_id: S.A.e[1], montant: 300, mode: 'especes' });
  await must(A, 'POST', '/api/absences', { eleve_id: S.A.e[0], date_absence: jourPasse(1), periode: 'journee' });
  await must(A, 'POST', '/api/absences', { eleve_id: S.A.e[1], date_absence: jourPasse(2), periode: 'matin', justifiee: true, justification: 'Certificat médical' });
  await must(A, 'POST', '/api/absences', { eleve_id: S.A.e[2], date_absence: jourPasse(3), periode: 'journee' });
  if (!dimanche()) await must(A, 'POST', '/api/absences', { eleve_id: S.A.e[3], date_absence: today(), periode: 'journee' });
  // ---------- École B : petite ----------
  const B = S.B.admin;
  const cb = (await must(B, 'POST', '/api/classes', { niveau: '1ère année', section: 'B', capacite: 10 })).id;
  S.B.e = [(await eleve(B, 'Bilel', { classe_id: cb })).id, (await eleve(B, 'Badr', { classe_id: cb })).id];
  await must(B, 'POST', '/api/users', { nom: 'Enseignb', prenom: 'Test', email: `ens-b-${stamp}@se.test`, role: 'enseignant', password: PW });
  await must(B, 'POST', '/api/tarifs', { libelle: 'Scolarité B', type: 'scolarite', niveau: '1ère année', montant: 1000 });
  await must(B, 'POST', '/api/paiements', { eleve_id: S.B.e[0], montant: 50, mode: 'mobile_money', reference: `MM-${stamp}` });
  await must(B, 'POST', '/api/absences', { eleve_id: S.B.e[1], date_absence: jourPasse(1), periode: 'apres_midi' });
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@se.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

test('école A : tous les chiffres correspondent exactement aux données de A', async () => {
  const s = await stats('A');
  assert.equal(s.ecole.id, S.A.id); assert.equal(s.ecole.nom, S.A.nom); assert.equal(s.annee, config.anneeCourante);
  // utilisateurs : 1 directeur + 2 enseignants + 3 parents + 1 comptable + 6 comptes élèves (un par élève)
  assert.deepEqual([s.utilisateurs.directeurs, s.utilisateurs.enseignants, s.utilisateurs.parents, s.utilisateurs.comptables, s.utilisateurs.comptes_eleves, s.utilisateurs.total], [1, 2, 3, 1, 6, 13]);
  assert.deepEqual([s.eleves.total, s.eleves.actifs, s.eleves.inactifs, s.eleves.diplomes, s.eleves.garcons, s.eleves.filles, s.eleves.actifs_sans_classe, s.eleves.actifs_en_classe], [6, 5, 1, 0, 4, 2, 1, 4]);
  assert.deepEqual([s.classes.annee, s.classes.capacite_totale], [2, 50]);
  assert.deepEqual(s.classes.liste.map((c) => [c.nom, c.capacite, c.effectif, c.absences]), [['1ère année A', 20, 2, 2], ['2ème année A', 30, 2, dimanche() ? 1 : 2]]);
  const nbAbs = dimanche() ? 3 : 4;
  assert.deepEqual([s.absences.total, s.absences.justifiees, s.absences.non_justifiees, s.absences.eleves_concernes], [nbAbs, 1, nbAbs - 1, nbAbs]);
  assert.equal(s.absences.par_mois.reduce((t, m) => t + m.total, 0), nbAbs, 'le total par mois = le total des absences');
  // présences : 4 élèves actifs scolarisés ; 1 absent aujourd'hui (sauf dimanche : école fermée)
  assert.equal(s.presences.eleves_scolarises, 4);
  if (dimanche()) assert.deepEqual([s.presences.presents_aujourdhui, s.presences.absents_aujourdhui], [null, null]);
  else assert.deepEqual([s.presences.presents_aujourdhui, s.presences.absents_aujourdhui, s.absences.aujourdhui], [3, 1, 1]);
  // paiements : 450 encaissés, 2 élèves ayant payé ; dû = 300 × 2 élèves de 1ère année actifs (A1, A2) ; reste = 300-150 = 150 (A2 a tout payé)
  assert.deepEqual([s.paiements.nombre, s.paiements.total_encaisse, s.paiements.eleves_payeurs], [3, 450, 2]);
  assert.deepEqual([s.paiements.total_du, s.paiements.total_impaye, s.paiements.eleves_avec_impaye, s.paiements.taux_recouvrement], [600, 150, 1, 75]);
  assert.deepEqual(s.paiements.par_mode.map((m) => [m.mode, m.nombre, m.total]).sort(), [['especes', 2, 400], ['virement', 1, 50]]);
  assert.equal(s.paiements.par_mois.reduce((t, m) => t + m.total, 0), 450);
  assert.deepEqual([s.abonnement.formule, s.abonnement.quota_eleves.utilise, s.abonnement.quota_utilisateurs.utilise, s.abonnement.quota_utilisateurs.limite], ['standard', 6, 7, 80]);
});

test('école B : ses propres chiffres, différents de A', async () => {
  const s = await stats('B');
  assert.equal(s.ecole.id, S.B.id);
  assert.deepEqual([s.utilisateurs.enseignants, s.utilisateurs.parents, s.utilisateurs.total, s.eleves.actifs, s.classes.annee], [1, 0, 4, 2, 1]);
  assert.deepEqual([s.absences.total, s.paiements.nombre, s.paiements.total_encaisse, s.paiements.total_du, s.paiements.total_impaye, s.paiements.eleves_avec_impaye], [1, 1, 50, 2000, 1950, 2]);
  assert.deepEqual(s.paiements.par_mode.map((m) => m.mode), ['mobile_money']);
});

test('école C (vide) : zéros, et rien venant des autres écoles', async () => {
  const s = await stats('C');
  assert.equal(s.ecole.id, S.C.id);
  assert.deepEqual([s.utilisateurs.total, s.eleves.total, s.classes.annee, s.absences.total, s.paiements.nombre, s.paiements.total_encaisse, s.paiements.total_du, s.devoirs.total, s.evaluations.notes], [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([s.presences.presents_aujourdhui === null || s.presences.presents_aujourdhui === 0, s.paiements.taux_recouvrement, s.evaluations.moyenne_sur_20, s.classes.liste.length], [true, null, null, 0]);
});

test('aucun mélange : chaque réponse ne contient que son école, et correspond à un décompte SQL filtré par school_id', async () => {
  for (const k of ['A', 'B', 'C']) {
    const s = await stats(k); const id = S[k].id; const txt = JSON.stringify(s);
    for (const o of ['A', 'B', 'C'].filter((x) => x !== k)) assert.ok(!txt.includes(S[o].nom) && !txt.includes(`Ville${o}`) && !txt.includes(`@se.test`), `${k} ne doit contenir aucune trace de ${o}`);
    assert.equal(s.utilisateurs.total, await un('SELECT COUNT(*) n FROM users WHERE school_id=$1 AND deleted_at IS NULL', [id]));
    assert.equal(s.eleves.total, await un('SELECT COUNT(*) n FROM eleves WHERE school_id=$1 AND deleted_at IS NULL', [id]));
    assert.equal(s.classes.toutes_annees, await un('SELECT COUNT(*) n FROM classes WHERE school_id=$1 AND deleted_at IS NULL', [id]));
    assert.equal(s.absences.total, await un('SELECT COUNT(*) n FROM absences WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2', [id, config.anneeCourante]));
    assert.equal(s.paiements.nombre, await un('SELECT COUNT(*) n FROM paiements WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2', [id, config.anneeCourante]));
    assert.equal(s.paiements.total_encaisse, await un('SELECT COALESCE(SUM(montant),0) n FROM paiements WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2', [id, config.anneeCourante]));
  }
  // la somme des écoles de test = le total de ces trois écoles dans la base (rien n'est compté deux fois ni perdu)
  const tot = await Promise.all(['A', 'B', 'C'].map(stats));
  assert.equal(tot.reduce((t, s) => t + s.eleves.total, 0), await un('SELECT COUNT(*) n FROM eleves WHERE school_id = ANY($1) AND deleted_at IS NULL', [ids]));
  assert.equal(tot.reduce((t, s) => t + s.utilisateurs.total, 0), await un('SELECT COUNT(*) n FROM users WHERE school_id = ANY($1) AND deleted_at IS NULL', [ids]));
});

test('cohérent avec le tableau de bord du même directeur (mêmes formules)', async () => {
  for (const k of ['A', 'B', 'C']) {
    const s = await stats(k); const d = await must(S[k].admin, 'GET', '/api/dashboard');
    assert.deepEqual([d.eleves, d.classes, d.enseignants, d.paiements_mois, d.impayes, d.total_impaye, d.preinscriptions_attente],
      [s.eleves.actifs, s.classes.annee, s.utilisateurs.enseignants, s.paiements.encaisse_ce_mois, s.paiements.eleves_avec_impaye, s.paiements.total_impaye, s.preinscriptions.en_attente], `école ${k}`);
  }
});

test('dynamique : une modification dans B change B aussitôt et laisse A intacte', async () => {
  const a0 = await stats('A'); const b0 = await stats('B');
  const e = (await eleve(S.B.admin, 'Bechir', { classe_id: (await db.qa('SELECT id FROM classes WHERE school_id=$1', [S.B.id])).rows[0].id })).id;
  await must(S.B.admin, 'POST', '/api/paiements', { eleve_id: e, montant: 20, mode: 'especes' });
  await must(S.B.admin, 'POST', '/api/absences', { eleve_id: e, date_absence: jourPasse(1), periode: 'journee' });
  const b1 = await stats('B'); const a1 = await stats('A');
  assert.deepEqual([b1.eleves.actifs, b1.paiements.nombre, b1.paiements.total_encaisse, b1.absences.total], [b0.eleves.actifs + 1, b0.paiements.nombre + 1, b0.paiements.total_encaisse + 20, b0.absences.total + 1]);
  delete a0.genere_le; delete a1.genere_le; assert.deepEqual(a1, a0, "les statistiques de A n'ont pas bougé");
  // suppression d'une absence : le total diminue
  const abs = (await must(S.B.admin, 'GET', '/api/absences')).find((x) => x.eleve_id === e);
  await must(S.B.admin, 'DELETE', `/api/absences/${abs.id}`);
  assert.equal((await stats('B')).absences.total, b0.absences.total);
});

test('un directeur ne peut atteindre que sa propre école (global, autres écoles, paramètres forgés)', async () => {
  for (const [k, o] of [['A', 'B'], ['B', 'A'], ['C', 'A']]) {
    assert.equal((await call(S[k].admin, 'GET', '/api/stats/global')).status, 403, `${k} : /global refusé`);
    assert.equal((await call(S[k].admin, 'GET', `/api/stats/ecole/${S[o].id}`)).status, 404, `${k} : école ${o} introuvable`);
    assert.equal((await call(S[k].admin, 'GET', '/api/stats/ecole/999999')).status, 404);
    const own = await call(S[k].admin, 'GET', `/api/stats/ecole/${S[k].id}`);
    assert.equal(own.status, 200); assert.equal(own.data.ecole.id, S[k].id);
    const forged = await call(S[k].admin, 'GET', `/api/stats/mon-ecole?school_id=${S[o].id}&ecole=${S[o].id}&slug=x`);
    assert.equal(forged.data.ecole.id, S[k].id, 'un school_id forgé dans la requête est ignoré');
  }
});

test('droits : refusé sans connexion, aux enseignants, parents, comptables, élèves ; le super-administrateur utilise /global', async () => {
  assert.equal((await call(null, 'GET', '/api/stats/mon-ecole')).status, 401);
  for (const em of [`ens1-a-${stamp}`, `par1-a-${stamp}`, `cpt1-a-${stamp}`]) assert.equal((await call(await login(`${em}@se.test`), 'GET', '/api/stats/mon-ecole')).status, 403, em);
  const eleveEmail = (await db.qa("SELECT email FROM users WHERE school_id=$1 AND role='eleve' LIMIT 1", [S.A.id])).rows[0].email;
  assert.equal((await call(await login(eleveEmail), 'GET', '/api/stats/mon-ecole')).status, 403, 'élève');
  assert.equal((await call(sup, 'GET', '/api/stats/mon-ecole')).status, 403, "le super-administrateur n'a pas d'école");
  const g = await call(sup, 'GET', '/api/stats/global');
  assert.equal(g.status, 200); assert.equal(g.data.vue, 'superadmin');
  for (const k of ['A', 'B', 'C']) { // la page du super-administrateur reste cohérente avec chaque école
    const l = g.data.ecoles.find((x) => x.id === S[k].id); const s = await stats(k);
    assert.deepEqual([l.eleves, l.utilisateurs, l.classes, l.parents, l.enseignants], [s.eleves.total, s.utilisateurs.total, s.classes.toutes_annees, s.utilisateurs.parents, s.utilisateurs.enseignants], `école ${k}`);
  }
});

test('relations entre tables et school_id : aucune donnée ne référence une autre école', async () => {
  assert.deepEqual(await verifier(), []);
});

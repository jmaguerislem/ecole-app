// Tests d'isolation entre écoles (guide « Isolation entre écoles », étapes 6 et 7).
// Deux écoles fictives, Alpha (A) et Bravo (B) : chacune avec 1 direction, 1 enseignant, 1 parent, 3 élèves, des paiements, notes,
// absences, annonces, messages, devoirs avec fichier. Chaque test est joué dans les DEUX sens (A→B et B→A).
// Lancer : DATABASE_URL=postgres://… npm test   (la base doit être migrée ; les écoles de test sont supprimées à la fin)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let superToken; const S = {}; // S.A et S.B : { id, slug, nom, marker, admin, ens, parent, ids… }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
const jourPasse = () => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const annee = Number(config.anneeCourante.slice(0, 4));

async function call(token, method, url, body, form) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  let payload; if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, ct };
}
const must = async (token, method, url, body, form) => { const r = await call(token, method, url, body, form); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r.data; };
const login = async (email) => (await must(null, 'POST', '/api/auth/login', { email, password: PW })).token;
const refuse = (r, msg) => assert.ok([400, 403, 404, 409].includes(r.status), `${msg} : attendu refus, reçu ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
const sens = [['A', 'B'], ['B', 'A']];

async function creerEcole(label, nom, marker) {
  const slug = `iso-${label.toLowerCase()}-${stamp}`;
  const e = await must(superToken, 'POST', '/api/saas/schools', { nom, slug, status: 'active', plan: 'standard', admin: { email: `dir-${label}-${stamp}@test.tn`, nom: 'Direction', prenom: `Ecole ${label}`, password: PW } });
  const s = { id: e.id, slug, nom, marker, label };
  s.admin = await login(`dir-${label}-${stamp}@test.tn`);
  s.classe = (await must(s.admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 20 })).id;
  s.matiere = (await must(s.admin, 'POST', '/api/matieres', { nom: `Maths ${marker}`, coefficient: 1 })).id;
  s.ensId = (await must(s.admin, 'POST', '/api/users', { nom: 'Prof', prenom: `Ens ${marker}`, email: `ens-${label}-${stamp}@test.tn`, role: 'enseignant', password: PW })).id;
  s.parentId = (await must(s.admin, 'POST', '/api/users', { nom: 'Parent', prenom: `Par ${marker}`, email: `par-${label}-${stamp}@test.tn`, role: 'parent', password: PW })).id;
  s.eleves = [];
  for (const [i, n] of ['Un', 'Deux', 'Trois'].entries()) {
    const el = await must(s.admin, 'POST', '/api/eleves', { nom: marker, prenom: `${marker}${n}`, date_naissance: '2018-05-05', classe_id: s.classe, matricule: `MAT00${i + 1}`, statut: 'actif', parent_ids: i < 2 ? [s.parentId] : [] });
    s.eleves.push(el.id);
  }
  s.affectation = (await must(s.admin, 'POST', '/api/affectations', { enseignant_id: s.ensId, matiere_id: s.matiere, classe_id: s.classe })).id;
  s.tarif = (await must(s.admin, 'POST', '/api/tarifs', { libelle: `Scolarité ${marker}`, type: 'scolarite', montant: 300 })).id;
  s.paiement = (await must(s.admin, 'POST', '/api/paiements', { eleve_id: s.eleves[0], tarif_id: s.tarif, montant: 100, mode: 'especes' })).id;
  s.evaluation = (await must(s.admin, 'POST', '/api/evaluations', { classe_id: s.classe, matiere_id: s.matiere, titre: `Contrôle ${marker}`, bareme: 20, date_eval: `${annee}-10-15` })).id;
  await must(s.admin, 'PUT', `/api/evaluations/${s.evaluation}/notes`, { notes: [{ eleve_id: s.eleves[0], valeur: 15 }] });
  await must(s.admin, 'PUT', '/api/absences/appel', { classe_id: s.classe, date_absence: jourPasse(), absents: [{ eleve_id: s.eleves[1], periode: 'journee' }] });
  s.absence = (await must(s.admin, 'GET', '/api/absences'))[0].id;
  s.annonce = (await must(s.admin, 'POST', '/api/annonces', { titre: `Annonce ${marker}`, corps: `Contenu réservé à ${marker}`, audience: 'tous' })).id;
  s.message = (await must(s.admin, 'POST', '/api/messages', { objet: `Message ${marker}`, corps: 'Bonjour', destinataires: JSON.stringify([s.parentId]), brouillon: 'false' })).id;
  s.ens = await login(`ens-${label}-${stamp}@test.tn`); s.parent = await login(`par-${label}-${stamp}@test.tn`);
  const f = new FormData();
  for (const [k, v] of Object.entries({ titre: `Devoir ${marker}`, description: 'À faire', matiere_id: s.matiere, classe_id: s.classe, date_remise: new Date(Date.now() + 7 * 864e5).toISOString(), bareme: 20 })) f.append(k, String(v));
  f.append('fichiers', new Blob([`fichier secret de ${marker}`], { type: 'text/plain' }), 'consigne.txt');
  const dv = await must(s.ens, 'POST', '/api/devoirs', undefined, f);
  s.devoir = dv.id; s.fichier = (typeof dv.fichiers === 'string' ? JSON.parse(dv.fichiers) : dv.fichiers)[0].name;
  s.pre = (await must(null, 'POST', `/api/public/${slug}/preinscriptions`, { eleve_nom: marker, eleve_prenom: 'Candidat', date_naissance: '2018-03-04', parent_nom: 'Parent', parent_prenom: 'Candidat', parent_email: `cand-${label}-${stamp}@test.tn`, consentement_rgpd: true })).id;
  return s;
}

test.before(async () => {
  await migrate();
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Test','Super',NULL)", [`sa-${stamp}@saas.test`, await bcrypt.hash(PW, 8)]);
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  superToken = await login(`sa-${stamp}@saas.test`);
  S.A = await creerEcole('A', `École Alpha ${stamp}`, 'Alpha');
  S.B = await creerEcole('B', `École Bravo ${stamp}`, 'Bravo');
});

test.after(async () => {
  const ids = [S.A?.id, S.B?.id].filter(Boolean);
  const tables = (await db.qa("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public')")).rows.map((r) => r.tablename);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [`sa-${stamp}@saas.test`]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@saas.test`]).catch(() => {});
  for (const id of ids) fs.rmSync(path.join(config.uploadDir, String(id)), { recursive: true, force: true });
  await new Promise((r) => server.close(r)); await db.end();
});

for (const [v, o] of sens) {
  const V = () => S[v]; const O = () => S[o];
  const noms = (list) => list.map((x) => x.nom || x.titre || x.eleve_nom || '');

  test(`${v}→${o} · les listes ne contiennent que les données de l'école ${v}`, async () => {
    const eleves = await must(V().admin, 'GET', '/api/eleves');
    assert.equal(eleves.length, 3); assert.ok(eleves.every((e) => e.nom === V().marker));
    for (const res of ['classes', 'matieres', 'users', 'affectations', 'tarifs', 'evaluations', 'paiements', 'absences', 'annonces', 'devoirs', 'preinscriptions']) {
      const l = await must(V().admin, 'GET', `/api/${res}`);
      const txt = JSON.stringify(l);
      assert.ok(l.length > 0, `${res} : liste vide`);
      assert.ok(!txt.includes(O().marker), `${res} : données de ${o} visibles pour ${v}`);
      assert.ok(!txt.includes(O().slug) && !txt.includes(`-${O().label}-${stamp}`), `${res} : e-mail ou identifiant de ${o} visible`);
    }
  });

  test(`${v}→${o} · ouvrir/modifier/supprimer par numéro une donnée de ${o} est refusé`, async () => {
    const cibles = { eleves: O().eleves[0], classes: O().classe, matieres: O().matiere, users: O().parentId, affectations: O().affectation, tarifs: O().tarif, evaluations: O().evaluation, paiements: O().paiement, absences: O().absence, preinscriptions: O().pre };
    for (const [res, id] of Object.entries(cibles)) {
      const propre = { eleves: V().eleves[0], classes: V().classe, matieres: V().matiere, users: V().parentId, affectations: V().affectation, tarifs: V().tarif, evaluations: V().evaluation, paiements: V().paiement, absences: V().absence, preinscriptions: V().pre }[res];
      assert.equal((await call(V().admin, 'GET', `/api/${res}/${propre}`)).status, 200, `${res} : l'accès à sa propre donnée doit fonctionner`);
      refuse(await call(V().admin, 'GET', `/api/${res}/${id}`), `GET ${res}/${id}`);
      refuse(await call(V().admin, 'PUT', `/api/${res}/${id}`, { notes: 'piraté', nom: 'Piraté', titre: 'Piraté' }), `PUT ${res}/${id}`);
      refuse(await call(V().admin, 'DELETE', `/api/${res}/${id}`), `DELETE ${res}/${id}`);
    }
    // la donnée de l'autre école est intacte
    const intact = await db.qa('SELECT 1 FROM paiements WHERE id=$1 AND deleted_at IS NULL AND notes IS DISTINCT FROM $2', [O().paiement, 'piraté']);
    assert.equal(intact.rowCount, 1);
  });

  test(`${v}→${o} · fichiers, reçus et bulletins de ${o} : refusés`, async () => {
    assert.equal((await call(O().admin, 'GET', `/api/files/${O().fichier}`)).status, 200, `${o} doit pouvoir lire son propre fichier`);
    assert.equal((await call(V().admin, 'GET', `/api/files/${O().fichier}`)).status, 404);
    assert.equal((await call(V().ens, 'GET', `/api/files/${O().fichier}`)).status, 404);
    assert.equal((await call(V().admin, 'GET', `/api/files/..%2F${O().id}%2F${O().fichier}`)).status, 404);
    assert.ok(fs.existsSync(path.join(config.uploadDir, String(O().id), O().fichier)) && !fs.existsSync(path.join(config.uploadDir, String(V().id), O().fichier)));
    assert.equal((await call(V().admin, 'GET', `/api/paiements/${V().paiement}/recu`)).status, 200);
    refuse(await call(V().admin, 'GET', `/api/paiements/${O().paiement}/recu`), 'reçu étranger');
    assert.equal((await call(V().admin, 'GET', `/api/eleves/${V().eleves[0]}/bulletin.pdf`)).status, 200);
    refuse(await call(V().admin, 'GET', `/api/eleves/${O().eleves[0]}/bulletin.pdf`), 'bulletin étranger');
    refuse(await call(V().admin, 'GET', `/api/eleves/${O().eleves[0]}/bulletin`), 'bulletin JSON étranger');
  });

  test(`${v}→${o} · exports, recherche, statistiques : uniquement l'école ${v}`, async () => {
    const csv = (await call(V().admin, 'GET', '/api/eleves/export')).data;
    assert.ok(csv.includes(V().marker) && !csv.includes(O().marker), 'export CSV');
    assert.equal((await must(V().admin, 'GET', `/api/eleves?q=${V().marker}`)).length, 3, 'la recherche trouve les élèves de sa propre école');
    assert.equal((await must(V().admin, 'GET', `/api/eleves?q=${O().marker}`)).length, 0, `la recherche ne trouve rien dans l'école ${o}`);
    assert.equal((await must(V().admin, 'GET', `/api/eleves?school_id=${O().id}`)).length, 3, "le paramètre school_id de l'adresse doit être ignoré");
    const d = await must(V().admin, 'GET', '/api/dashboard');
    assert.equal(d.eleves, 3); assert.equal(d.classes, 1);
    assert.equal((await must(V().admin, 'GET', '/api/dashboard?school_id=' + O().id)).eleves, 3);
  });

  test(`${v}→${o} · parent et enseignant de ${v} : périmètre limité`, async () => {
    const enfants = await must(V().parent, 'GET', '/api/eleves');
    assert.deepEqual(enfants.map((e) => e.id).sort(), V().eleves.slice(0, 2).sort(), 'le parent ne voit que ses enfants');
    refuse(await call(V().parent, 'GET', `/api/eleves/${V().eleves[2]}`), "enfant d'un autre parent de la même école");
    refuse(await call(V().parent, 'GET', `/api/eleves/${O().eleves[0]}`), 'enfant de l\'autre école');
    refuse(await call(V().parent, 'GET', `/api/paiements/${O().paiement}/recu`), 'reçu étranger (parent)');
    const mine = await must(V().ens, 'GET', '/api/eleves');
    assert.equal(mine.length, 3); assert.ok(mine.every((e) => e.nom === V().marker));
    refuse(await call(V().ens, 'GET', `/api/eleves/${O().eleves[0]}`), 'élève étranger (enseignant)');
    refuse(await call(V().ens, 'PUT', '/api/absences/appel', { classe_id: O().classe, date_absence: jourPasse(), absents: [] }), "appel dans la classe de l'autre école");
    refuse(await call(V().ens, 'GET', `/api/absences/appel?classe_id=${O().classe}&date=${jourPasse()}`), "liste d'appel de l'autre école");
  });

  test(`${v}→${o} · impossible de relier ou d'envoyer vers une donnée de ${o}`, async () => {
    const d = jourPasse();
    refuse(await call(V().admin, 'POST', '/api/absences', { eleve_id: O().eleves[0], date_absence: d, periode: 'matin' }), 'absence sur élève étranger');
    refuse(await call(V().admin, 'POST', '/api/paiements', { eleve_id: O().eleves[0], montant: 10, mode: 'especes' }), 'paiement sur élève étranger');
    refuse(await call(V().admin, 'POST', '/api/paiements', { eleve_id: V().eleves[0], tarif_id: O().tarif, montant: 10, mode: 'especes' }), 'paiement avec tarif étranger');
    refuse(await call(V().admin, 'POST', '/api/affectations', { enseignant_id: O().ensId, matiere_id: V().matiere, classe_id: V().classe }), 'affectation enseignant étranger');
    refuse(await call(V().admin, 'POST', '/api/affectations', { enseignant_id: V().ensId, matiere_id: O().matiere, classe_id: O().classe }), 'affectation classe étrangère');
    refuse(await call(V().admin, 'POST', '/api/evaluations', { classe_id: O().classe, matiere_id: O().matiere, titre: 'Piratage', bareme: 20 }), 'évaluation classe étrangère');
    refuse(await call(V().admin, 'PUT', `/api/evaluations/${V().evaluation}/notes`, { notes: [{ eleve_id: O().eleves[0], valeur: 1 }] }), 'note sur élève étranger');
    refuse(await call(V().admin, 'PUT', `/api/eleves/${V().eleves[0]}`, { classe_id: O().classe }), 'élève dans la classe étrangère');
    refuse(await call(V().admin, 'PUT', `/api/eleves/${V().eleves[0]}`, { parent_ids: [O().parentId] }), 'parent étranger');
    refuse(await call(V().admin, 'PUT', `/api/classes/${V().classe}`, { titulaire_id: O().ensId }), 'titulaire étranger');
    const avant = Number((await db.qa('SELECT COUNT(*) n FROM message_recipients WHERE user_id=$1', [O().parentId])).rows[0].n);
    await call(V().admin, 'POST', '/api/messages', { objet: 'Intrusion', corps: 'Bonjour', destinataires: JSON.stringify([O().parentId]), brouillon: 'false' });
    assert.equal(Number((await db.qa('SELECT COUNT(*) n FROM message_recipients WHERE user_id=$1', [O().parentId])).rows[0].n), avant, `aucun message ne doit atteindre un parent de ${o}`);
  });

  test(`${v}→${o} · annonces et relances n'atteignent que l'école ${v}`, async () => {
    const compte = async (school) => Number((await db.qa('SELECT (SELECT COUNT(*) FROM notifications WHERE school_id=$1) + (SELECT COUNT(*) FROM messages WHERE school_id=$1) n', [school])).rows[0].n);
    const avantO = await compte(O().id);
    await must(V().admin, 'POST', '/api/annonces', { titre: `Réunion ${V().marker}`, corps: 'Réunion des parents ce jeudi', audience: 'parents' });
    await call(V().admin, 'POST', '/api/paiements/relances', {});
    assert.equal(await compte(O().id), avantO, `aucune notification ni message ne doit être créé dans ${o}`);
    assert.equal((await must(O().admin, 'GET', '/api/annonces')).filter((a) => a.titre.includes(V().marker)).length, 0);
  });

  test(`${v}→${o} · filtre au niveau de la base : lecture, écriture et création croisées bloquées`, async () => {
    await db.runWith({ schoolId: V().id }, async () => {
      assert.equal((await db.q('SELECT * FROM eleves WHERE school_id=$1', [O().id])).rowCount, 0);
      assert.equal((await db.q('SELECT * FROM eleves WHERE id=$1', [O().eleves[0]])).rowCount, 0);
      assert.equal((await db.q("UPDATE eleves SET nom='Piraté' WHERE id=$1", [O().eleves[0]])).rowCount, 0);
      assert.equal((await db.q('DELETE FROM paiements WHERE id=$1', [O().paiement])).rowCount, 0);
      await assert.rejects(() => db.q("INSERT INTO classes(niveau,capacite,annee_scolaire,school_id) VALUES ('1ère année',10,'2026-2027',$1)", [O().id]), /row-level security/);
      await assert.rejects(() => db.q('INSERT INTO absences(eleve_id,date_absence,periode,annee_scolaire) VALUES ($1,$2,$3,$4)', [O().eleves[0], jourPasse(), 'matin', config.anneeCourante]), /autre école|row-level/);
      assert.equal((await db.q('SELECT * FROM schools')).rowCount, 1, 'une école ne voit que sa propre ligne');
    });
    await db.runWith({ schoolId: null }, async () => { assert.equal((await db.q('SELECT * FROM eleves')).rowCount, 0, 'sans école : aucune donnée'); });
    await db.runWith(undefined, async () => { assert.equal((await db.q('SELECT * FROM users')).rowCount, 0); });
  });

  test(`${v}→${o} · jeton falsifié (autre école) refusé`, async () => {
    const u = (await db.qa('SELECT id FROM users WHERE email=$1', [`dir-${v.toLowerCase()}-${stamp}@test.tn`])).rows[0];
    const faux = jwt.sign({ sub: u.id, role: 'admin', sch: O().id }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await call(faux, 'GET', '/api/eleves')).status, 401);
  });
}

test('matricule : même valeur autorisée dans deux écoles, interdite dans la même école', async () => {
  for (const l of ['A', 'B']) {
    assert.equal((await db.qa("SELECT COUNT(*) n FROM eleves WHERE matricule='MAT001' AND school_id=$1", [S[l].id])).rows[0].n, 1);
    const r = await call(S[l].admin, 'POST', '/api/eleves', { nom: S[l].marker, prenom: 'Doublon', matricule: 'MAT001', statut: 'actif' });
    assert.equal(r.status, 409);
  }
});

test('e-mail : unique dans toute la base (connexion sans choix d\'école)', async () => {
  const r = await call(S.B.admin, 'POST', '/api/users', { nom: 'Copie', prenom: 'Parent', email: `par-A-${stamp}@test.tn`, role: 'parent', password: PW });
  assert.ok([409, 400].includes(r.status));
});

test('super-administrateur : voit les écoles mais aucune donnée d\'école ; la direction ne gère pas les écoles', async () => {
  const l = await must(superToken, 'GET', '/api/saas/schools');
  assert.ok(l.find((e) => e.id === S.A.id) && l.find((e) => e.id === S.B.id));
  for (const res of ['eleves', 'classes', 'users', 'paiements', 'absences', 'annonces', 'devoirs', 'tarifs', 'evaluations', 'preinscriptions', 'audit']) {
    const r = await call(superToken, 'GET', `/api/${res}`);
    assert.ok(r.status !== 200 || (Array.isArray(r.data) && r.data.length === 0), `super-admin /${res} : aucune donnée d'école ne doit être visible (reçu ${r.status})`);
  }
  assert.equal((await call(S.A.admin, 'GET', '/api/saas/schools')).status, 403);
  assert.equal((await call(S.A.admin, 'PUT', `/api/saas/schools/${S.B.id}`, { status: 'suspended' })).status, 403);
  const me = await must(S.A.admin, 'GET', '/api/auth/me'); assert.equal(me.school.id, S.A.id);
});

test('école suspendue ou abonnement expiré : accès coupé, les autres écoles ne sont pas touchées', async () => {
  await must(superToken, 'PUT', `/api/saas/schools/${S.B.id}`, { status: 'suspended' });
  assert.equal((await call(S.B.admin, 'GET', '/api/eleves')).status, 403);
  assert.equal((await call(S.B.parent, 'GET', '/api/eleves')).status, 403);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: `dir-B-${stamp}@test.tn`, password: PW })).status, 403);
  assert.equal((await call(null, 'POST', `/api/public/${S.B.slug}/preinscriptions`, { eleve_nom: 'X' })).status, 403);
  assert.equal((await call(S.A.admin, 'GET', '/api/eleves')).status, 200);
  await must(superToken, 'PUT', `/api/saas/schools/${S.B.id}`, { status: 'active' });
  assert.equal((await call(S.B.admin, 'GET', '/api/eleves')).status, 200);
  await db.qa("UPDATE schools SET subscription_end = CURRENT_DATE - 2 WHERE id=$1", [S.B.id]);
  assert.equal((await call(S.B.admin, 'GET', '/api/eleves')).status, 403);
  await db.qa('UPDATE schools SET subscription_end = NULL WHERE id=$1', [S.B.id]);
  assert.equal((await call(S.B.admin, 'GET', '/api/eleves')).status, 200);
});

test('pré-inscription publique : arrive dans la bonne école ; école inconnue ou non précisée refusée', async () => {
  assert.equal((await db.qa('SELECT school_id FROM preinscriptions WHERE id=$1', [S.A.pre])).rows[0].school_id, S.A.id);
  assert.equal((await db.qa('SELECT school_id FROM preinscriptions WHERE id=$1', [S.B.pre])).rows[0].school_id, S.B.id);
  assert.equal((await call(null, 'POST', '/api/public/ecole-inconnue/preinscriptions', { eleve_nom: 'X' })).status, 404);
  assert.equal((await call(null, 'POST', '/api/public/preinscriptions', { eleve_nom: 'X' })).status, 400);
});

test('concurrence : 40 requêtes simultanées des deux écoles (lectures + envois de fichiers) sans mélange', async () => {
  const lectures = [];
  for (let i = 0; i < 20; i++) for (const l of ['A', 'B']) lectures.push(call(S[l].admin, 'GET', '/api/eleves').then((r) => ({ l, r })));
  const envois = [];
  for (let i = 0; i < 6; i++) for (const l of ['A', 'B']) {
    const f = new FormData();
    for (const [k, v] of Object.entries({ titre: `Concurrent ${S[l].marker} ${i}`, description: 'x', matiere_id: S[l].matiere, classe_id: S[l].classe, date_remise: new Date(Date.now() + 3 * 864e5).toISOString(), bareme: 20 })) f.append(k, String(v));
    f.append('fichiers', new Blob([`secret ${l}`], { type: 'text/plain' }), `c${i}.txt`);
    envois.push(call(S[l].ens, 'POST', '/api/devoirs', undefined, f).then((r) => ({ l, r })));
  }
  for (const { l, r } of await Promise.all(lectures)) { assert.equal(r.status, 200); assert.ok(r.data.every((e) => e.nom === S[l].marker), `lecture mélangée pour ${l}`); }
  for (const { l, r } of await Promise.all(envois)) {
    assert.equal(r.status, 201, JSON.stringify(r.data).slice(0, 150));
    const row = (await db.qa('SELECT school_id FROM devoirs WHERE id=$1', [r.data.id])).rows[0];
    assert.equal(row.school_id, S[l].id, `devoir créé dans la mauvaise école (${l})`);
    const fichiers = typeof r.data.fichiers === 'string' ? JSON.parse(r.data.fichiers) : r.data.fichiers;
    assert.ok(fs.existsSync(path.join(config.uploadDir, String(S[l].id), fichiers[0].name)), `fichier rangé dans le mauvais dossier (${l})`);
  }
});

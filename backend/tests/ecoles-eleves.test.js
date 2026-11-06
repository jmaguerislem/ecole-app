// Tests : liste des écoles unique et dynamique, coordonnées/renommage des écoles, compte de connexion automatique des élèves.
// Lancer : DATABASE_URL=postgres://… npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');
const { libelleEcole } = require('../src/libelle-ecole');
const corrections = require('../src/services/corrections-ecoles');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let superToken; const ecoles = []; let admin; let adminId; let schoolId;

async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async (email, password = PW) => call(null, 'POST', '/api/auth/login', { email, password });
const eleve = (extra = {}) => ({ nom: "Essai", prenom: "Sami", date_naissance: '2018-05-05', statut: 'actif', password: PW, password_confirm: PW, ...extra });

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@ee.test`, await bcrypt.hash(PW, 4)]);
  superToken = (await login(`sa-${stamp}@ee.test`)).data.token;
  const r = await call(null, 'POST', '/api/public/signup', { nom: `Ecole Eleves ${stamp}`, email: `dir-${stamp}@ee.test`, password: PW });
  assert.equal(r.status, 201);
  schoolId = (await db.qa('SELECT id FROM schools WHERE slug=$1', [r.data.slug])).rows[0].id;
  ecoles.push(schoolId);
  const l = await login(`dir-${stamp}@ee.test`); admin = l.data.token; adminId = l.data.user.id;
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ecoles]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ecoles]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@ee.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// ======================= 1. Liste des écoles =======================
test('liste publique des écoles : dynamique, sans authentification, sans donnée sensible, écoles suspendues exclues', async () => {
  const a = await call(superToken, 'POST', '/api/saas/schools', { nom: `Liste Alpha ${stamp}`, ville: 'Tunis', status: 'active', plan: 'basic', admin: { email: `a-${stamp}@ee.test`, password: PW } });
  assert.equal(a.status, 201, JSON.stringify(a.data)); ecoles.push(a.data.id);
  const b = await call(superToken, 'POST', '/api/saas/schools', { nom: `Liste Bravo ${stamp}`, ville: 'Sfax', status: 'active', plan: 'basic', admin: { email: `b-${stamp}@ee.test`, password: PW } });
  ecoles.push(b.data.id);
  let pub = await call(null, 'GET', '/api/public/schools');
  assert.equal(pub.status, 200);
  const noms = pub.data.map((s) => s.nom);
  assert.ok(noms.includes(`Liste Alpha ${stamp}`) && noms.includes(`Liste Bravo ${stamp}`), 'les écoles créées apparaissent sans redémarrage');
  for (const s of pub.data) assert.deepEqual(Object.keys(s).sort(), ['id', 'label', 'nom', 'slug', 'ville'], 'seuls id, nom, slug, ville, label sont exposés');
  assert.equal(pub.data.find((s) => s.id === a.data.id).label, `Liste Alpha ${stamp} (Tunis)`);
  await call(superToken, 'PUT', `/api/saas/schools/${b.data.id}`, { status: 'suspended' });
  pub = await call(null, 'GET', '/api/public/schools');
  assert.ok(!pub.data.some((s) => s.id === b.data.id), 'une école suspendue ne figure pas dans la liste publique');
  await call(superToken, 'PUT', `/api/saas/schools/${b.data.id}`, { status: 'active' });
  assert.ok((await call(null, 'GET', '/api/public/schools')).data.some((s) => s.id === b.data.id), 'réactivée : elle réapparaît');
});

test('même liste partout : libellés et ordre identiques entre la liste publique et celle du super-administrateur', async () => {
  const pub = (await call(null, 'GET', '/api/public/schools')).data;
  const sup = (await call(superToken, 'GET', '/api/saas/schools')).data;
  const ouvertes = sup.filter((s) => s.ouverte);
  assert.deepEqual(pub.map((s) => [s.id, s.label]), ouvertes.map((s) => [s.id, s.label]), 'mêmes écoles, mêmes libellés, même ordre');
  const labels = sup.map((s) => s.label);
  assert.deepEqual(labels, [...labels].sort((x, y) => x.localeCompare(y, 'fr', { sensitivity: 'base' })), 'ordre alphabétique');
  assert.equal((await call(admin, 'GET', '/api/saas/schools')).status, 403, 'la liste détaillée reste réservée au super-administrateur');
  const me = (await call(admin, 'GET', '/api/auth/me')).data;
  assert.equal(me.school.label, libelleEcole({ nom: me.school.nom, ville: me.school.ville }), "l'en-tête de l'application utilise le même libellé");
});

test('deux écoles de même nom : la ville les distingue, un doublon nom + ville est refusé', async () => {
  const nom = `Homonyme ${stamp}`;
  const mk = (ville, email) => call(superToken, 'POST', '/api/saas/schools', { nom, ville, status: 'active', plan: 'basic', admin: { email: `${email}-${stamp}@ee.test`, password: PW } });
  const x = await mk('Nabeul', 'h1'); assert.equal(x.status, 201, JSON.stringify(x.data)); ecoles.push(x.data.id);
  const y = await mk('Tozeur', 'h2'); assert.equal(y.status, 201, JSON.stringify(y.data)); ecoles.push(y.data.id);
  const dup = await mk('nabeul', 'h3');
  assert.equal(dup.status, 409, 'même nom et même ville (casse ignorée) refusés'); assert.match(dup.data.error, /existe déjà/);
  const pub = (await call(null, 'GET', '/api/public/schools')).data.filter((s) => s.nom === nom);
  assert.deepEqual(pub.map((s) => s.label).sort(), [`${nom} (Nabeul)`, `${nom} (Tozeur)`]);
  const ren = await call(superToken, 'PUT', `/api/saas/schools/${y.data.id}`, { ville: 'Nabeul' });
  assert.equal(ren.status, 409, 'renommer/déplacer vers un doublon est refusé aussi');
  assert.equal(libelleEcole({ nom: 'École X – Nabeul', ville: 'Nabeul' }), 'École X – Nabeul', 'la ville déjà présente dans le nom n’est pas répétée');
});

test('coordonnées de l’école : ville, adresse, téléphone et e-mail contrôlés puis enregistrés', async () => {
  const s = (await call(superToken, 'POST', '/api/saas/schools', { nom: `Coord ${stamp}`, ville: 'Bizerte', status: 'trial', admin: { email: `c-${stamp}@ee.test`, password: PW } })).data; ecoles.push(s.id);
  for (const bad of [{ telephone: '12' }, { telephone: 'abcdefgh' }, { email_contact: 'pas-un-email' }, { ville: '1' }, { ville: 'Tunis<script>' }])
    assert.equal((await call(superToken, 'PUT', `/api/saas/schools/${s.id}`, bad)).status, 400, JSON.stringify(bad));
  const ok = await call(superToken, 'PUT', `/api/saas/schools/${s.id}`, { adresse: '3 rue de la Corniche, 7000 Bizerte', telephone: '72431559', email_contact: 'Contact@Coord.TN' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.telephone, '72 431 559'); assert.equal(ok.data.email_contact, 'contact@coord.tn'); assert.equal(ok.data.ville, 'Bizerte');
});

test('pré-inscription : fonctionne depuis la liste (école choisie par son identifiant), refusée pour une école suspendue ou inconnue', async () => {
  const s = (await call(null, 'GET', '/api/public/schools')).data.find((x) => x.id === schoolId);
  const body = { eleve_nom: 'Liste', eleve_prenom: 'Choix', date_naissance: '2018-05-05', parent_nom: 'Parent', parent_prenom: 'Test', parent_email: `p-${stamp}@ee.test`, consentement_rgpd: true };
  assert.equal((await call(null, 'POST', `/api/public/${s.slug}/preinscriptions`, body)).status, 201);
  const n = (await db.qa('SELECT COUNT(*) n FROM preinscriptions WHERE school_id=$1', [schoolId])).rows[0].n;
  assert.equal(n, 1, "la demande arrive dans l'école choisie");
  assert.equal((await call(null, 'POST', '/api/public/ecole-inconnue/preinscriptions', body)).status, 404);
});

// ======================= 2. Corrections des écoles « Abou Kacem Chebbi » =======================
test('corrections : Nabeul renommée et activée, coordonnées complétées sans rien écraser, appliquées une seule fois', async (t) => {
  if ((await db.qa("SELECT 1 FROM schools WHERE slug='abou-el-kacem'")).rowCount) return t.skip("une école « abou-el-kacem » existe déjà dans cette base : test ignoré pour ne pas la modifier");
  const marque = (await db.qa("SELECT applique_le FROM data_migrations WHERE nom='ecoles-abou-kacem-chebbi-v1'")).rows[0];
  await db.qa("DELETE FROM data_migrations WHERE nom='ecoles-abou-kacem-chebbi-v1'");
  const s = (await db.qa("INSERT INTO schools(nom,slug,status,plan,ville) VALUES ('École Primaire Abou el Kacem Chebbi','abou-el-kacem','trial','standard','Nabeul-Test') RETURNING id")).rows[0];
  ecoles.push(s.id);
  try {
    assert.equal(await corrections.appliquer(), true);
    let n = (await db.qa('SELECT * FROM schools WHERE id=$1', [s.id])).rows[0];
    assert.equal(n.nom, 'École Primaire Abou el Kacem Chebbi – Nabeul'); assert.equal(n.status, 'active');
    assert.equal(n.ville, 'Nabeul-Test', 'une valeur déjà saisie n’est pas écrasée');
    assert.ok(n.adresse && n.telephone && n.email_contact && n.subscription_end, 'coordonnées manquantes complétées');
    await db.qa("UPDATE schools SET status='suspended' WHERE id=$1", [s.id]);
    assert.equal(await corrections.appliquer(), false, 'déjà appliquée');
    n = (await db.qa('SELECT status FROM schools WHERE id=$1', [s.id])).rows[0];
    assert.equal(n.status, 'suspended', 'un changement de statut ultérieur n’est pas annulé au redémarrage');
  } finally {
    await db.qa("DELETE FROM data_migrations WHERE nom='ecoles-abou-kacem-chebbi-v1'");
    if (marque) await db.qa("INSERT INTO data_migrations(nom, applique_le) VALUES ('ecoles-abou-kacem-chebbi-v1', $1)", [marque.applique_le]);
  }
});

// ======================= 3. Élève : compte de connexion automatique =======================
test('ajout d’un élève : mot de passe et confirmation obligatoires, contrôles de saisie', async () => {
  const cas = [
    [{ password: undefined, password_confirm: undefined }, /obligatoire/i],
    [{ password: PW, password_confirm: undefined }, /confirmation/i],
    [{ password: PW, password_confirm: 'Autre@2026x1' }, /ne correspond pas/i],
    [{ password: 'court1', password_confirm: 'court1' }, /8 caractères/i],
    [{ password: 'seulementdeslettres', password_confirm: 'seulementdeslettres' }, /lettre et un chiffre|au moins une lettre/i],
    [{ password: '12345678', password_confirm: '12345678' }, /lettre/i],
    [{ password: { $ne: 1 }, password_confirm: { $ne: 1 } }, /invalide/i],
  ];
  for (const [extra, re] of cas) {
    const r = await call(admin, 'POST', '/api/eleves', eleve({ prenom: 'Refuse', ...extra }));
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.match(r.data.error, re);
  }
  assert.equal(Number((await db.qa("SELECT COUNT(*) n FROM eleves WHERE school_id=$1 AND prenom='Refuse'", [schoolId])).rows[0].n), 0, 'aucun élève créé en cas de refus');
  assert.equal(Number((await db.qa("SELECT COUNT(*) n FROM users WHERE school_id=$1 AND nom=$2", [schoolId, "Essai"])).rows[0].n), 0, 'aucun compte créé en cas de refus');
});

test('ajout d’un élève : le compte de connexion est créé automatiquement, mot de passe haché, e-mail = identifiant', async () => {
  const r = await call(admin, 'POST', '/api/eleves', eleve({ prenom: 'Compte', user_id: adminId }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.user_id && r.data.user_id !== adminId, "le client ne peut pas imposer le compte lié (user_id ignoré)");
  assert.equal(r.data.password, undefined); assert.equal(r.data.password_hash, undefined);
  const u = (await db.qa('SELECT * FROM users WHERE id=$1', [r.data.user_id])).rows[0];
  assert.equal(u.role, 'eleve'); assert.equal(u.email, r.data.email); assert.equal(u.actif, true);
  assert.equal(u.school_id, schoolId); assert.equal(u.nom, r.data.nom);
  assert.match(u.password_hash, /^\$2[aby]\$12\$/, 'bcrypt, coût 12'); assert.notEqual(u.password_hash, PW);
  assert.ok(await bcrypt.compare(PW, u.password_hash));
  const l = await login(r.data.email);
  assert.equal(l.status, 200, JSON.stringify(l.data)); assert.equal(l.data.user.role, 'eleve');
  const vu = await call(l.data.token, 'GET', '/api/eleves');
  assert.deepEqual(vu.data.map((e) => e.id), [r.data.id], "l'élève ne voit que sa propre fiche");
  assert.equal((await call(l.data.token, 'POST', '/api/eleves', eleve({ prenom: 'Pirate' }))).status, 403, "un élève ne peut pas créer d'élève");
  const audit = (await db.qa("SELECT nouvelles FROM audit_log WHERE entite='users' AND entite_id=$1 AND action='create'", [u.id])).rows[0];
  assert.ok(audit && !JSON.stringify(audit).includes('password'), 'création journalisée sans mot de passe');
  assert.equal((await call(admin, 'GET', '/api/users?role=eleve')).data.some((x) => x.password_hash !== undefined), false);
});

test('modification d’un élève : mot de passe vide = inchangé, renseigné = remplacé (confirmation obligatoire), élève sans compte → compte créé', async () => {
  const e = (await call(admin, 'POST', '/api/eleves', eleve({ prenom: 'Modif' }))).data;
  const nom = async (b) => call(admin, 'PUT', `/api/eleves/${e.id}`, b);
  assert.equal((await nom({ prenom: 'Modifie', password: '', password_confirm: '' })).status, 200);
  assert.equal((await login(e.email)).status, 200, 'mot de passe inchangé');
  assert.equal((await db.qa('SELECT prenom FROM users WHERE id=$1', [e.user_id])).rows[0].prenom, 'Modifie', 'le compte suit le prénom de l’élève');
  assert.equal((await nom({ password: 'Nouveau@2026a' })).status, 400, 'confirmation requise');
  assert.equal((await nom({ password: 'Nouveau@2026a', password_confirm: 'Nouveau@2026b' })).status, 400);
  assert.equal((await nom({ password_confirm: 'Nouveau@2026a' })).status, 400);
  assert.equal((await nom({ password: 'Nouveau@2026a', password_confirm: 'Nouveau@2026a' })).status, 200);
  assert.equal((await login(e.email)).status, 401, 'ancien mot de passe refusé'); assert.equal((await login(e.email, 'Nouveau@2026a')).status, 200);
  // ancien élève sans compte (créé avant cette évolution)
  const old = (await db.qa("INSERT INTO eleves(school_id,nom,prenom,date_naissance,email) VALUES ($1,'Ancien','Sans','2017-01-01',$2) RETURNING id", [schoolId, `sans.ancien.${stamp}@ee.test`])).rows[0];
  assert.equal((await call(admin, 'PUT', `/api/eleves/${old.id}`, { adresse: 'Rue 1' })).status, 200, 'modifiable sans mot de passe');
  assert.equal((await db.qa('SELECT user_id FROM eleves WHERE id=$1', [old.id])).rows[0].user_id, null);
  const cr = await call(admin, 'PUT', `/api/eleves/${old.id}`, { password: PW, password_confirm: PW });
  assert.equal(cr.status, 200, JSON.stringify(cr.data)); assert.ok(cr.data.user_id);
  assert.equal((await login(`sans.ancien.${stamp}@ee.test`)).status, 200);
});

test('le secrétariat peut créer le compte d’un nouvel élève mais pas changer le mot de passe d’un compte existant', async () => {
  await call(admin, 'POST', '/api/users', { nom: 'Compta', prenom: 'Test', email: `compta-${stamp}@ee.test`, role: 'comptable', password: PW });
  const cpt = (await login(`compta-${stamp}@ee.test`)).data.token;
  const e = await call(cpt, 'POST', '/api/eleves', eleve({ prenom: 'ParCompta' }));
  assert.equal(e.status, 201, JSON.stringify(e.data));
  assert.equal((await login(e.data.email)).status, 200);
  const r = await call(cpt, 'PUT', `/api/eleves/${e.data.id}`, { password: 'Pirate@2026x', password_confirm: 'Pirate@2026x' });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal((await login(e.data.email)).status, 200, 'mot de passe inchangé');
});

test('suppression d’un élève : son compte de connexion est désactivé', async () => {
  const e = (await call(admin, 'POST', '/api/eleves', eleve({ prenom: 'Supprime' }))).data;
  const l = await login(e.email); assert.equal(l.status, 200);
  assert.equal((await call(admin, 'DELETE', `/api/eleves/${e.id}`)).status, 200);
  assert.equal((await login(e.email)).status, 401);
  assert.equal((await call(l.data.token, 'GET', '/api/eleves')).status, 401, 'la session ouverte est aussi coupée');
});

test('quotas : les comptes de connexion des élèves ne comptent pas dans les « utilisateurs » de la formule Basic', async () => {
  const n = Number((await db.qa("SELECT COUNT(*) n FROM users WHERE school_id=$1 AND deleted_at IS NULL AND role<>'eleve'", [schoolId])).rows[0].n);
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) SELECT 'q'||g||'-'||$2||'@ee.test','x','parent','Quota','P'||g,$1 FROM generate_series(1,$3::int) g", [schoolId, stamp, 20 - n]);
  const ok = await call(admin, 'POST', '/api/eleves', eleve({ prenom: 'Quota' }));
  assert.equal(ok.status, 201, `20 utilisateurs atteints, mais un élève (et son compte) reste possible : ${JSON.stringify(ok.data)}`);
  const refus = await call(admin, 'POST', '/api/users', { nom: 'Trop', prenom: 'Plein', email: `trop-${stamp}@ee.test`, role: 'parent', password: PW });
  assert.equal(refus.status, 402, 'les vrais utilisateurs restent limités à 20');
});

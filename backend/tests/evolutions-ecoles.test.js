// Tests : e-mail unique PAR ÉCOLE (connexion, mot de passe oublié), e-mail d'identifiants à la création d'un compte (mot de passe provisoire),
// notification du super-administrateur à l'inscription d'une école, suppression complète d'une école dans la base.
// Les e-mails sont capturés en mémoire (MAIL_TRANSPORT=memory) : aucun envoi réel.
process.env.MAIL_TRANSPORT = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const migrate = require('../src/migrate');
const db = require('../src/db');
const config = require('../src/config');
const { sent, simulerEchec } = require('../src/services/mailer');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
const ecoles = []; let base; let server; let superToken; let superId;
let ip = '10.1.0.1'; const depuis = (n) => { ip = `10.1.0.${n}`; };
const superMail = `sa-${stamp}@ecoles.test`; const copie = `copie-${stamp}@ecoles.test`;

async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => null) : await res.text() };
}
const login = (email, password = PW, school) => call(null, 'POST', '/api/auth/login', { email, password, ...(school ? { school } : {}) });
const mailsA = (to) => sent.filter((m) => m.to === to);
const attendre = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await new Promise((r) => setTimeout(r, 80)); } };
async function nouvelleEcole(nom, email, password = PW) {
  const r = await call(null, 'POST', '/api/public/signup', { nom, email, password });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = (await db.qa('SELECT id FROM schools WHERE slug=$1', [r.data.slug])).rows[0].id; ecoles.push(id);
  const l = await login(email, password, r.data.slug); assert.equal(l.status, 200, JSON.stringify(l.data));
  return { id, slug: r.data.slug, nom, admin: l.data.token, email };
}

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  superId = (await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Super','Test',NULL) RETURNING id", [superMail, await bcrypt.hash(PW, 10)])).rows[0].id;
  superToken = (await login(superMail)).data.token; assert.ok(superToken);
});
test.after(async () => {
  const tables = (await db.qa("SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((x) => x.table_name);
  await new Promise((r) => setTimeout(r, 400));
  for (const id of ecoles) {
    for (let pass = 0; pass < 8; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id=$1`, [id]).catch(() => {});
    await db.qa('DELETE FROM schools WHERE id=$1', [id]).catch(() => {});
    fs.rmSync(path.join(config.uploadDir, String(id)), { recursive: true, force: true });
  }
  await db.qa('DELETE FROM notification_log WHERE user_id=$1', [superId]).catch(() => {});
  await db.qa("DELETE FROM audit_log WHERE user_id=$1 OR (action='delete' AND entite='schools' AND anciennes->>'nom' LIKE $2)", [superId, `%${stamp}%`]).catch(() => {});
  await db.qa('DELETE FROM users WHERE id=$1', [superId]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// ---------------------------------------------------------------- e-mail unique par école
test('même e-mail d\'enseignant dans deux écoles : accepté ; doublon dans la même école : refusé avec un message clair', async () => {
  depuis(2);
  const A = await nouvelleEcole(`Ecole A ${stamp}`, `dir-a-${stamp}@ecoles.test`);
  const B = await nouvelleEcole(`Ecole B ${stamp}`, `dir-b-${stamp}@ecoles.test`, 'Autre@2026Bb2');
  const ens = (nom) => ({ nom, prenom: 'Ali', email: copie, role: 'enseignant', password: nom === 'Premier' ? 'Prof@2026Aa1' : 'Prof@2026Bb2', telephone: '93273101' });
  const a = await call(A.admin, 'POST', '/api/users', ens('Premier')); assert.equal(a.status, 201, JSON.stringify(a.data));
  // nouvelle école vide : l'enseignant n'existe pas dans CETTE école, l'ajout doit réussir malgré l'autre école
  const lb = await call(B.admin, 'GET', '/api/users?role=enseignant'); assert.equal(lb.data.length, 0, 'école B vide');
  const b = await call(B.admin, 'POST', '/api/users', ens('Second')); assert.equal(b.status, 201, JSON.stringify(b.data));
  const bis = await call(B.admin, 'POST', '/api/users', ens('Second')); assert.equal(bis.status, 409); assert.match(bis.data.error, /déjà utilisée par un compte de cette école/);
  assert.equal((await call(A.admin, 'POST', '/api/users', ens('Premier'))).status, 409, 'doublon dans l\'école A refusé aussi');
  // chaque école ne voit que son enseignant
  assert.equal((await call(A.admin, 'GET', '/api/users?role=enseignant')).data.length, 1);
  assert.equal((await call(B.admin, 'GET', '/api/users?role=enseignant')).data.length, 1);
  // même identifiant, mots de passe différents : chacun entre dans SA école, sans rien choisir
  assert.equal((await login(copie, 'Prof@2026Aa1')).data.user.school.id, A.id);
  assert.equal((await login(copie, 'Prof@2026Bb2')).data.user.school.id, B.id);
  assert.equal((await login(copie, 'Faux@2026Zz9')).status, 401);
  // modification : prendre l'e-mail d'un autre compte de la même école reste refusé
  const autre = await call(B.admin, 'POST', '/api/users', { nom: 'Autre', prenom: 'Prof', email: `autre-${stamp}@ecoles.test`, role: 'enseignant', password: PW });
  assert.equal((await call(B.admin, 'PUT', `/api/users/${autre.data.id}`, { email: copie })).status, 409);
  A.keep = true; B.keep = true;
});
test('connexion : même e-mail ET même mot de passe dans deux écoles → l\'école est demandée, puis acceptée', async () => {
  depuis(3);
  const mail = `jumeau-${stamp}@ecoles.test`;
  const A = await nouvelleEcole(`Jumeau A ${stamp}`, mail); const B = await nouvelleEcole(`Jumeau B ${stamp}`, mail);
  const ambigu = await login(mail);
  assert.equal(ambigu.status, 409); assert.equal(ambigu.data.code, 'school_required');
  assert.deepEqual(ambigu.data.ecoles.map((e) => e.slug).sort(), [A.slug, B.slug].sort());
  assert.ok(ambigu.data.ecoles.every((e) => e.nom.includes(stamp)), 'noms d\'écoles proposés');
  assert.equal((await login(mail, PW, A.slug)).data.user.school.id, A.id);
  assert.equal((await login(mail, PW, B.slug)).data.user.school.id, B.id);
  assert.equal((await login(mail, PW, 'ecole-inconnue')).status, 401);
  assert.equal((await login(mail, 'Faux@2026Zz9')).status, 401, 'mauvais mot de passe : rien n\'est révélé sur les écoles');
});
test('mot de passe oublié avec une adresse présente dans deux écoles : un code par compte, chaque code ne change que SON compte', async () => {
  depuis(4);
  const mail = `oubli2-${stamp}@ecoles.test`;
  const A = await nouvelleEcole(`Oubli A ${stamp}`, mail, 'Oubli@2026Aa1'); const B = await nouvelleEcole(`Oubli B ${stamp}`, mail, 'Oubli@2026Bb2');
  const avant = mailsA(mail).length;
  assert.equal((await call(null, 'POST', '/api/auth/forgot-password', { email: mail })).status, 200);
  const recus = mailsA(mail).slice(avant); assert.equal(recus.length, 2, 'un e-mail par école');
  const mA = recus.find((m) => m.subject.includes(A.nom)); const mB = recus.find((m) => m.subject.includes(B.nom));
  assert.ok(mA && mB, 'l\'objet indique l\'école');
  const code = (m) => /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(m.text)[1];
  assert.equal((await call(null, 'POST', '/api/auth/set-password', { email: mail, code: code(mA), password: 'Nouveau@2026A1' })).status, 200);
  assert.equal((await login(mail, 'Nouveau@2026A1')).data.user.school.id, A.id, 'le compte de l\'école A a le nouveau mot de passe');
  assert.equal((await login(mail, 'Oubli@2026Bb2')).data.user.school.id, B.id, 'le compte de l\'école B est inchangé');
  assert.equal((await login(mail, 'Oubli@2026Aa1')).status, 401, 'ancien mot de passe de A refusé');
});

// ---------------------------------------------------------------- e-mail d'identifiants à la création d'un utilisateur
test('création d\'un enseignant : e-mail avec identifiant et mot de passe provisoire, changement obligatoire à la première connexion', async () => {
  depuis(5);
  const E = await nouvelleEcole(`Ident ${stamp}`, `dir-ident-${stamp}@ecoles.test`);
  const mail = `prof-${stamp}@ecoles.test`; const provisoire = 'Provisoire@2026a1';
  const r = await call(E.admin, 'POST', '/api/users', { nom: 'Gharbi', prenom: 'Sami', email: mail, role: 'enseignant', password: provisoire, telephone: '93273101' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.email_envoye, true); assert.equal(r.data.must_change_password, true);
  assert.equal(JSON.stringify(r.data).includes(provisoire), false, 'la réponse API ne renvoie pas le mot de passe');
  const m = mailsA(mail).at(-1); assert.ok(m, 'e-mail envoyé à l\'utilisateur');
  assert.match(m.subject, new RegExp(`\\[Ident ${stamp}\\].*compte a été créé`));
  assert.ok(m.text.includes(mail), 'identifiant dans l\'e-mail'); assert.ok(m.text.includes(provisoire), 'mot de passe initial dans l\'e-mail');
  assert.match(m.text, /première connexion/); assert.match(m.text, /compte enseignant a été créé/);
  const bd = (await db.qa('SELECT must_change_password, invitation_envoyee_at, invitation_erreur, password_hash FROM users WHERE email=$1 AND school_id=$2', [mail, E.id])).rows[0];
  assert.equal(bd.must_change_password, true); assert.ok(bd.invitation_envoyee_at); assert.equal(bd.invitation_erreur, null); assert.notEqual(bd.password_hash, provisoire, 'mot de passe haché en base');
  // première connexion : tout est refusé tant que le mot de passe n'est pas changé
  const l = await login(mail, provisoire, E.slug); assert.equal(l.status, 200); assert.equal(l.data.user.must_change_password, true);
  assert.equal((await call(l.data.token, 'GET', '/api/classes')).status, 403, 'API bloquée avant le changement');
  assert.equal((await call(l.data.token, 'POST', '/api/auth/change-password', { ancien: provisoire, nouveau: provisoire, confirmation: provisoire })).status, 400, 'doit être différent');
  assert.equal((await call(l.data.token, 'POST', '/api/auth/change-password', { ancien: provisoire, nouveau: 'MonVrai@2026b2', confirmation: 'MonVrai@2026b2' })).status, 200);
  assert.equal((await call(l.data.token, 'GET', '/api/classes')).status, 200, 'API accessible après le changement');
  assert.equal((await login(mail, provisoire, E.slug)).status, 401); assert.equal((await login(mail, 'MonVrai@2026b2', E.slug)).status, 200);
  // les autres rôles reçoivent le même e-mail (comptable, direction) ; modification d'un compte : pas de nouvel e-mail
  const avant = sent.length;
  assert.equal((await call(E.admin, 'PUT', `/api/users/${r.data.id}`, { specialite: 'Arabe' })).status, 200);
  assert.equal(sent.length, avant, 'pas d\'e-mail à la modification');
  const c = await call(E.admin, 'POST', '/api/users', { nom: 'Compta', prenom: 'Lina', email: `compta-${stamp}@ecoles.test`, role: 'comptable', password: PW });
  assert.equal(c.data.email_envoye, true); assert.match(mailsA(`compta-${stamp}@ecoles.test`).at(-1).text, /comptabilité/);
});
test('création d\'un compte : panne d\'envoi signalée (compte créé), mot de passe jamais journalisé', async () => {
  depuis(6);
  const E = await nouvelleEcole(`Panne ${stamp}`, `dir-panne-${stamp}@ecoles.test`);
  const mail = `panne-${stamp}@ecoles.test`; simulerEchec('SMTP indisponible');
  const r = await call(E.admin, 'POST', '/api/users', { nom: 'Panne', prenom: 'Test', email: mail, role: 'enseignant', password: 'Provisoire@2026z9' });
  simulerEchec(null);
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.email_envoye, false); assert.match(r.data.email_erreur, /SMTP/);
  assert.equal(r.data.invitation_erreur, 'SMTP indisponible');
  const journal = (await db.qa("SELECT statut, erreur FROM notification_log WHERE user_id=$1 AND canal='email'", [r.data.id])).rows;
  assert.deepEqual(journal.map((x) => x.statut), ['echec']); assert.ok(!JSON.stringify(journal).includes('Provisoire@2026z9'));
  // mot de passe identique à l'e-mail et trop faible : refusés, aucun compte créé
  assert.equal((await call(E.admin, 'POST', '/api/users', { nom: 'Egal', prenom: 'Test', email: `egal-${stamp}@ecoles.test`, role: 'enseignant', password: `egal-${stamp}@ecoles.test` })).status, 400);
  assert.equal((await call(E.admin, 'POST', '/api/users', { nom: 'Faible', prenom: 'Test', email: `faible-${stamp}@ecoles.test`, role: 'enseignant', password: 'court' })).status, 400);
  assert.equal((await db.qa("SELECT COUNT(*)::int n FROM users WHERE email LIKE $1 AND school_id=$2", [`%-${stamp}@ecoles.test`, E.id])).rows[0].n, 2, 'direction + enseignant en panne seulement');
});

// ---------------------------------------------------------------- notification du super-administrateur
test('inscription d\'une école : le super-administrateur est prévenu par e-mail avec les informations de l\'école, et sur son tableau de bord', async () => {
  depuis(7);
  process.env.SUPERADMIN_NOTIFY_EMAIL = `copie-notif-${stamp}@ecoles.test, adresse-invalide`;
  try {
    const nom = `Nouvelle Ecole ${stamp}`; const mail = `dir-notif-${stamp}@ecoles.test`;
    const E = await nouvelleEcole(nom, mail);
    const m = await attendre(() => mailsA(superMail).find((x) => x.subject.includes(nom)));
    assert.ok(m, 'e-mail reçu par le super-administrateur');
    assert.match(m.subject, /Nouvelle école inscrite/);
    for (const info of [nom, E.slug, mail, 'adresse non vérifiée', `/preinscription/${E.slug}`, 'Fin de l\'essai']) assert.ok(m.text.includes(info), `contient « ${info} »`);
    assert.ok(!m.text.includes(PW), 'aucun mot de passe dans la notification');
    assert.ok(await attendre(() => mailsA(`copie-notif-${stamp}@ecoles.test`).length), 'adresse supplémentaire SUPERADMIN_NOTIFY_EMAIL prévenue aussi');
    const log = await attendre(async () => (await db.qa("SELECT statut FROM notification_log WHERE user_id=$1 AND school_id=$2", [superId, E.id])).rows[0]);
    assert.equal(log.statut, 'envoye');
    const d = (await call(superToken, 'GET', '/api/saas/dashboard')).data;
    const x = d.inscriptions_recentes.find((i) => i.id === E.id); assert.ok(x, 'inscription visible sur le tableau de bord'); assert.equal(x.email, mail); assert.equal(x.email_confirme, false);
  } finally { delete process.env.SUPERADMIN_NOTIFY_EMAIL; }
});
test('inscription avec confirmation d\'e-mail : le super-administrateur est prévenu une fois l\'adresse confirmée (pas avant)', async () => {
  depuis(8);
  process.env.VERIFY_SIGNUP_EMAIL = 'true';
  try {
    const nom = `Confirmee ${stamp}`; const mail = `dir-conf-${stamp}@ecoles.test`;
    const r = await call(null, 'POST', '/api/public/signup', { nom, email: mail, password: PW }); assert.equal(r.status, 201);
    ecoles.push((await db.qa('SELECT id FROM schools WHERE slug=$1', [r.data.slug])).rows[0].id);
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(mailsA(superMail).filter((x) => x.subject.includes(nom)).length, 0, 'rien avant la confirmation');
    const code = /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(mailsA(mail).at(-1).text)[1];
    assert.equal((await call(null, 'POST', '/api/public/verify-email', { email: mail, code })).status, 200);
    const m = await attendre(() => mailsA(superMail).find((x) => x.subject.includes(nom)));
    assert.ok(m); assert.match(m.text, /adresse confirmée/);
  } finally { delete process.env.VERIFY_SIGNUP_EMAIL; }
});

// ---------------------------------------------------------------- suppression d'une école
test('suppression d\'une école : confirmation exigée, toutes ses données et ses fichiers effacés, les autres écoles intactes', async () => {
  depuis(9);
  const garde = await nouvelleEcole(`Gardee ${stamp}`, `dir-garde-${stamp}@ecoles.test`);
  const X = await nouvelleEcole(`A supprimer ${stamp}`, `dir-suppr-${stamp}@ecoles.test`);
  // données variées dans l'école X : une quinzaine de tables remplies, avec des références croisées (notes → évaluations → classes, paiements → élèves…)
  const ok = async (token, m, u, b, code = 201) => { const r = await call(token, m, u, b); assert.equal(r.status, code, `${m} ${u} : ${JSON.stringify(r.data)}`); return r.data; };
  const ens = await ok(X.admin, 'POST', '/api/users', { nom: 'Prof', prenom: 'Supprime', email: `prof-suppr-${stamp}@ecoles.test`, role: 'enseignant', password: PW });
  const par = await ok(X.admin, 'POST', '/api/users', { nom: 'Parent', prenom: 'Supprime', email: `par-suppr-${stamp}@ecoles.test`, role: 'parent', password: PW });
  const classe = await ok(X.admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 25, titulaire_id: ens.id });
  const matiere = await ok(X.admin, 'POST', '/api/matieres', { nom: `Maths ${stamp}`, coefficient: 2 });
  const salle = await ok(X.admin, 'POST', '/api/salles', { nom: 'Salle 1', capacite: 25 });
  const eleve = await ok(X.admin, 'POST', '/api/eleves', { nom: 'Eleve', prenom: 'Supprime', date_naissance: '2018-05-01', classe_id: classe.id, password: PW, password_confirm: PW });
  await ok(X.admin, 'POST', '/api/affectations', { enseignant_id: ens.id, matiere_id: matiere.id, classe_id: classe.id });
  await ok(X.admin, 'POST', '/api/creneaux', { classe_id: classe.id, matiere_id: matiere.id, enseignant_id: ens.id, salle_id: salle.id, jour: 3, heure_debut: '10:00', heure_fin: '11:00' });
  const evalu = await ok(X.admin, 'POST', '/api/evaluations', { classe_id: classe.id, matiere_id: matiere.id, titre: 'Controle', type: 'controle_continu', trimestre: 1, bareme: 20 });
  await ok(X.admin, 'PUT', `/api/evaluations/${evalu.id}/notes`, { notes: [{ eleve_id: eleve.id, valeur: 15 }] }, 200);
  const tarif = await ok(X.admin, 'POST', '/api/tarifs', { libelle: 'Scolarite', type: 'autre', montant: 500 });
  await ok(X.admin, 'POST', '/api/paiements', { eleve_id: eleve.id, tarif_id: tarif.id, montant: 100, mode: 'especes' });
  await ok(X.admin, 'POST', '/api/absences', { eleve_id: eleve.id, date_absence: '2026-11-18', periode: 'journee' });
  await ok(X.admin, 'POST', '/api/retards', { eleve_id: eleve.id, date_retard: '2026-11-19', minutes: 10 });
  await ok(X.admin, 'POST', '/api/annonces', { titre: 'Annonce X', corps: 'Contenu', audience: 'tous' });
  await ok(X.admin, 'POST', '/api/messages', { destinataires: JSON.stringify([ens.id, par.id]), objet: 'Bonjour', corps: 'Message envoye' });
  const dv = new FormData(); dv.append('titre', 'Devoir X'); dv.append('matiere_id', matiere.id); dv.append('classe_id', classe.id); dv.append('date_remise', new Date(Date.now() + 5 * 864e5).toISOString()); dv.append('fichiers', new Blob(['sujet'], { type: 'text/plain' }), 'sujet.txt');
  assert.equal((await fetch(`${base}/api/devoirs`, { method: 'POST', headers: { Authorization: `Bearer ${X.admin}`, 'X-Forwarded-For': ip }, body: dv })).status, 201);
  await ok(X.admin, 'POST', '/api/push/subscribe', { endpoint: 'fcm:jeton-ecole-supprimee', keys: { platform: 'android' } }, 200);
  const pre = await ok(null, 'POST', `/api/public/${X.slug}/preinscriptions`, { eleve_nom: 'Pre', eleve_prenom: 'Inscrit', date_naissance: '2018-03-04', parent_nom: 'Parent', parent_prenom: 'Pre', parent_email: `pre-${stamp}@ecoles.test`, consentement_rgpd: true });
  assert.ok(pre.id);
  const fd = new FormData(); fd.append('destinataires', '[]'); fd.append('objet', 'Brouillon'); fd.append('corps', 'Texte'); fd.append('brouillon', 'true'); fd.append('fichiers', new Blob(['piece jointe'], { type: 'text/plain' }), 'pj.txt');
  const msg = await fetch(`${base}/api/messages`, { method: 'POST', headers: { Authorization: `Bearer ${X.admin}`, 'X-Forwarded-For': ip }, body: fd }); assert.equal(msg.status, 201);
  const dossier = path.join(config.uploadDir, String(X.id)); assert.ok(fs.existsSync(dossier) && fs.readdirSync(dossier).length, 'fichier téléversé présent');
  await new Promise((r) => setTimeout(r, 500)); // laisse finir les écritures de journal en arrière-plan
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((x) => x.table_name);
  const compte = async (id) => { let n = 0; for (const t of tables) n += (await db.qa(`SELECT COUNT(*)::int n FROM ${t} WHERE school_id=$1`, [id])).rows[0].n; return n; };
  const avantX = await compte(X.id); const avantGarde = await compte(garde.id);
  const remplies = []; for (const t of tables) if ((await db.qa(`SELECT COUNT(*)::int n FROM ${t} WHERE school_id=$1`, [X.id])).rows[0].n > 0) remplies.push(t);
  assert.ok(remplies.length >= 15, `l'école X remplit au moins 15 tables avant suppression (remplies : ${remplies.join(', ')})`);
  for (const t of ['notes', 'evaluations', 'paiements', 'absences', 'eleves', 'users', 'message_recipients', 'devoirs']) assert.ok(remplies.includes(t), `table ${t} remplie`);

  // sécurité : refusé sans confirmation, refusé aux non super-administrateurs, 404 si inconnue
  assert.equal((await call(superToken, 'DELETE', `/api/saas/schools/${X.id}`)).status, 400);
  assert.equal((await call(X.admin, 'DELETE', `/api/saas/schools/${X.id}?confirmer=oui`)).status, 403, 'la direction ne supprime pas son école via cette route');
  assert.equal((await call(garde.admin, 'DELETE', `/api/saas/schools/${X.id}?confirmer=oui`)).status, 403);
  assert.equal((await call(superToken, 'DELETE', '/api/saas/schools/99999999?confirmer=oui')).status, 404);
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM schools WHERE id=$1', [X.id])).rows[0].n, 1, 'rien n\'est supprimé sans confirmation');

  const r = await call(superToken, 'DELETE', `/api/saas/schools/${X.id}?confirmer=oui`);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.supprimee, X.nom); assert.ok(r.data.utilisateurs >= 2 && r.data.eleves >= 1);
  // base de données : plus aucune ligne, ni dans la table des écoles
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM schools WHERE id=$1', [X.id])).rows[0].n, 0);
  assert.equal(await compte(X.id), 0, 'aucune ligne de l\'école X ne subsiste, dans aucune table');
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM password_setup_tokens t JOIN users u ON u.id=t.user_id WHERE u.school_id=$1', [X.id])).rows[0].n, 0);
  assert.equal(fs.existsSync(dossier), false, 'fichiers téléversés supprimés');
  const trace = (await db.qa("SELECT school_id, anciennes FROM audit_log WHERE action='delete' AND entite='schools' AND entite_id=$1", [X.id])).rows[0];
  assert.ok(trace && trace.school_id === null && trace.anciennes.nom === X.nom, 'trace de la suppression conservée');
  // conséquences : sessions et connexions de l'école supprimée coupées ; liste mise à jour ; autre école intacte
  assert.equal((await call(X.admin, 'GET', '/api/classes')).status, 401, 'session de l\'école supprimée invalide');
  assert.equal((await login(X.email, PW, X.slug)).status, 401);
  assert.ok(!(await call(superToken, 'GET', '/api/saas/schools')).data.some((s) => s.id === X.id));
  assert.equal(await compte(garde.id), avantGarde, 'l\'autre école est intacte');
  assert.equal((await call(garde.admin, 'GET', '/api/auth/me')).status, 200);
  assert.equal((await call(superToken, 'DELETE', `/api/saas/schools/${X.id}?confirmer=oui`)).status, 404, 'déjà supprimée');
});
test('liste des écoles : le nombre d\'élèves n\'est plus affiché (colonne retirée), le bouton Supprimer et sa confirmation existent', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/Ecoles.jsx'), 'utf8');
  assert.ok(!/<th>Élèves<\/th>/.test(src) && !/\{s\.nb_eleves\}<\/td>/.test(src), 'plus de colonne Élèves');
  assert.ok(/Supprimer<\/button>/.test(src) && /Confirmer la suppression/.test(src) && />Annuler</.test(src), 'bouton Supprimer + boîte Confirmer / Annuler');
  assert.ok(/method: 'DELETE'/.test(src) && /confirmer=oui/.test(src));
});

// Évolutions pour l'application mobile : comptes parents automatiques + e-mail, conflits d'emploi du temps, loyers du propriétaire.
// Lancer : DATABASE_URL=postgres://… npm test
process.env.MAIL_TRANSPORT = 'memory';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const migrate = require('../src/migrate');
const db = require('../src/db');
const mailer = require('../src/services/mailer');
const { app } = require('../src/index');

const PW = 'Test@2026x1';
const stamp = Date.now().toString(36);
let base; let server; let sa; const E = {}; // E.A, E.B : écoles de test
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
const decaler = (iso, n) => { const [y, m] = iso.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`; };
const finMois = (premier) => { const d = new Date(`${decaler(premier, 1)}T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

async function call(token, method, url, body) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}
const must = async (t, m, u, b) => { const r = await call(t, m, u, b); assert.ok(r.status < 300, `${m} ${u} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const login = async (email, password = PW) => (await must(null, 'POST', '/api/auth/login', { email, password })).token;
const mdpTemp = (mail) => /Mot de passe temporaire : (\S+)/.exec(mail.text)?.[1];
const codeDu = (mail) => /Code d'activation[^:]*: ([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(mail.text)?.[1];
const dernierMail = (to) => [...mailer.sent].reverse().find((m) => m.to === to);

async function creerEcole(label, extra = {}) {
  const slug = `mob-${label.toLowerCase()}-${stamp}`;
  const e = await must(sa, 'POST', '/api/saas/schools', { nom: `École Mobile ${label} ${stamp}`, slug, ville: 'Tunis', status: 'active', plan: 'premium', admin: { email: `dir-${label}-${stamp}@mob.tn`, nom: 'Direction', prenom: `Ecole ${label}`, password: PW }, ...extra });
  const s = { id: e.id, slug, label, admin: await login(`dir-${label}-${stamp}@mob.tn`) };
  s.classeA = (await must(s.admin, 'POST', '/api/classes', { niveau: '1ère année', section: 'A', capacite: 25 })).id;
  s.classeB = (await must(s.admin, 'POST', '/api/classes', { niveau: '2ème année', section: 'B', capacite: 25 })).id;
  s.matiere = (await must(s.admin, 'POST', '/api/matieres', { nom: `Maths ${label}`, coefficient: 1 })).id;
  s.ensX = (await must(s.admin, 'POST', '/api/users', { nom: 'Benali', prenom: 'Sami', email: `x-${label}-${stamp}@mob.tn`, role: 'enseignant', password: PW })).id;
  s.ensY = (await must(s.admin, 'POST', '/api/users', { nom: 'Trabelsi', prenom: 'Leila', email: `y-${label}-${stamp}@mob.tn`, role: 'enseignant', password: PW })).id;
  s.salle1 = (await must(s.admin, 'POST', '/api/salles', { nom: 'Salle 1', capacite: 25 })).id;
  s.salle2 = (await must(s.admin, 'POST', '/api/salles', { nom: 'Salle 2', capacite: 25 })).id;
  return s;
}
test.before(async () => {
  await migrate();
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Test','Mob',NULL)", [`sa-mob-${stamp}@saas.test`, await bcrypt.hash(PW, 8)]);
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  sa = await login(`sa-mob-${stamp}@saas.test`);
  E.A = await creerEcole('A', { site: `Site Test ${stamp}` });
  E.B = await creerEcole('B', { site: `Site Test ${stamp}` });
  E.C = await creerEcole('C'); // sans site : n'a aucun local en commun
});
test.after(async () => {
  const ids = [E.A?.id, E.B?.id, E.C?.id].filter(Boolean);
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name NOT IN ('schools','users')")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) { for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {}); await db.qa('DELETE FROM users WHERE school_id = ANY($1)', [ids]).catch(() => {}); }
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [`sa-mob-${stamp}@saas.test`]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-mob-${stamp}@saas.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

// ====================== Comptes parents automatiques ======================
const elevePayload = (s, nom, prenom, parent, extra = {}) => ({ password: PW, password_confirm: PW, nom, prenom, date_naissance: '2018-05-05', classe_id: s.classeA, statut: 'actif', parent, ...extra });

test('ajout d\'un élève : compte parent créé automatiquement, e-mail avec identifiants + mot de passe temporaire + infos de l\'enfant, changement obligatoire à la 1re connexion', async () => {
  const s = E.A; const mail = `parent1-${stamp}@famille.tn`;
  const el = await must(s.admin, 'POST', '/api/eleves', elevePayload(s, 'Gharbi', 'Youssef', { nom: 'Gharbi', prenom: 'Karim', email: mail, telephone: '20123456' }));
  assert.equal(el.invitation.compte_cree, true); assert.equal(el.invitation.email_envoye, true); assert.equal(el.invitation.erreur, null);
  const m = dernierMail(mail); assert.ok(m, 'e-mail envoyé au parent');
  assert.match(m.text, /Bienvenue/);
  assert.match(m.text, /Youssef Gharbi/, "nom et prénom de l'enfant");
  assert.match(m.text, /classe : 1ère année A/, "classe de l'enfant");
  assert.ok(m.text.includes(`Identifiant : ${mail}`), 'identifiant dans le message');
  const temp = mdpTemp(m); assert.ok(temp && temp.length >= 10, 'mot de passe temporaire présent');
  const u = (await db.qa('SELECT role, must_change_password, password_hash FROM users WHERE email=$1', [mail])).rows[0];
  assert.equal(u.role, 'parent'); assert.equal(u.must_change_password, true);
  assert.notEqual(u.password_hash, temp, 'le mot de passe temporaire est haché en base (jamais en clair)');
  // connexion avec le mot de passe temporaire : possible, mais seul le changement de mot de passe est autorisé
  const l = await must(null, 'POST', '/api/auth/login', { email: mail, password: temp });
  assert.equal(l.user.must_change_password, true);
  const forced = await call(l.token, 'GET', '/api/eleves');
  assert.equal(forced.status, 403); assert.equal(forced.data.code, 'password_change_required');
  assert.equal((await call(l.token, 'GET', '/api/messages')).status, 403);
  assert.equal((await call(l.token, 'GET', '/api/auth/me')).data.must_change_password, true);
  // mot de passe identique / trop faible refusés, puis changement réel
  assert.equal((await call(l.token, 'POST', '/api/auth/change-password', { ancien: temp, nouveau: temp, confirmation: temp })).status, 400);
  assert.equal((await call(l.token, 'POST', '/api/auth/change-password', { ancien: temp, nouveau: 'court', confirmation: 'court' })).status, 400);
  await must(l.token, 'POST', '/api/auth/change-password', { ancien: temp, nouveau: 'Nouveau@2026x', confirmation: 'Nouveau@2026x' });
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: temp })).status, 401, 'le mot de passe temporaire ne fonctionne plus');
  const tok = await login(mail, 'Nouveau@2026x');
  assert.equal((await must(null, 'POST', '/api/auth/login', { email: mail, password: 'Nouveau@2026x' })).user.must_change_password, false);
  const enfants = await must(tok, 'GET', '/api/eleves'); assert.equal(enfants.length, 1); assert.equal(enfants[0].nom, 'Gharbi');
  s.parentMail = mail; s.parentTok = tok;
});

test('deux enfants, un seul compte parent : pas de doublon, simple rattachement, mot de passe inchangé', async () => {
  const s = E.A;
  const el2 = await must(s.admin, 'POST', '/api/eleves', elevePayload(s, 'Gharbi', 'Mariem', { nom: 'Gharbi', prenom: 'Karim', email: s.parentMail.toUpperCase() }, { classe_id: s.classeB }));
  assert.equal(el2.invitation.compte_cree, false); assert.equal(el2.invitation.email_envoye, true);
  assert.equal((await db.qa('SELECT COUNT(*)::int n FROM users WHERE lower(email)=$1', [s.parentMail])).rows[0].n, 1);
  const m = dernierMail(s.parentMail);
  assert.match(m.text, /nouvel enfant/i); assert.match(m.text, /Mariem Gharbi/); assert.match(m.text, /Youssef Gharbi/); assert.match(m.text, /2ème année B/);
  assert.ok(!mdpTemp(m) && !codeDu(m), 'compte existant : aucun nouveau mot de passe');
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: s.parentMail, password: 'Nouveau@2026x' })).status, 200, 'mot de passe inchangé');
  assert.deepEqual((await must(s.parentTok, 'GET', '/api/eleves')).map((e) => e.prenom).sort(), ['Mariem', 'Youssef']);
});

test('panne d\'envoi d\'e-mail : l\'inscription est conservée, l\'échec est signalé, « renvoyer » génère un nouveau mot de passe temporaire (l\'ancien est invalidé)', async () => {
  const s = E.A; const mail = `parent2-${stamp}@famille.tn`;
  mailer.simulerEchec('SMTP indisponible');
  const el = await must(s.admin, 'POST', '/api/eleves', elevePayload(s, 'Jaziri', 'Adam', { nom: 'Jaziri', prenom: 'Nadia', email: mail }));
  mailer.simulerEchec(null);
  assert.equal(el.invitation.email_envoye, false); assert.match(el.invitation.erreur, /SMTP/);
  const u = (await db.qa('SELECT id, invitation_erreur FROM users WHERE email=$1', [mail])).rows[0]; assert.match(u.invitation_erreur, /SMTP/);
  const liste = (await must(s.admin, 'GET', `/api/users?role=parent`)).find((x) => x.email === mail); assert.ok(liste.invitation_erreur); assert.equal(liste.must_change_password, true);
  const r = await must(s.admin, 'POST', `/api/users/${u.id}/renvoyer-invitation`); assert.equal(r.email_envoye, true);
  const t1 = mdpTemp(dernierMail(mail)); assert.ok(t1);
  const apres = (await db.qa('SELECT invitation_erreur, invitation_envoyee_at FROM users WHERE id=$1', [u.id])).rows[0]; assert.equal(apres.invitation_erreur, null); assert.ok(apres.invitation_envoyee_at);
  await must(s.admin, 'POST', `/api/users/${u.id}/renvoyer-invitation`);
  const t2 = mdpTemp(dernierMail(mail)); assert.notEqual(t1, t2);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: mail, password: t1 })).status, 401, 'ancien mot de passe temporaire invalidé');
  const l = await must(null, 'POST', '/api/auth/login', { email: mail, password: t2 }); assert.equal(l.user.must_change_password, true);
  await must(l.token, 'POST', '/api/auth/change-password', { ancien: t2, nouveau: 'Nouveau@2026x', confirmation: 'Nouveau@2026x' });
  // compte activé : « renvoyer » est refusé (il verrouillerait le parent dehors)
  assert.equal((await call(s.admin, 'POST', `/api/users/${u.id}/renvoyer-invitation`)).status, 409);
});

test('e-mail parent déjà pris par un autre rôle ou une autre école : refus clair, aucun élève créé', async () => {
  const s = E.A; const avant = (await must(s.admin, 'GET', '/api/eleves')).length;
  const r1 = await call(s.admin, 'POST', '/api/eleves', elevePayload(s, 'Test', 'Doublon', { nom: 'Prof', prenom: 'Xavier', email: `x-A-${stamp}@mob.tn` }));
  assert.equal(r1.status, 409, JSON.stringify(r1.data)); assert.match(r1.data.error, /pas un compte parent/);
  const r2 = await call(E.B.admin, 'POST', '/api/eleves', elevePayload(E.B, 'Test', 'Autre', { nom: 'Gharbi', prenom: 'Karim', email: E.A.parentMail }));
  assert.equal(r2.status, 409, JSON.stringify(r2.data)); assert.match(r2.data.error, /autre établissement/); assert.ok(!r2.data.error.includes(E.A.slug));
  assert.equal((await must(s.admin, 'GET', '/api/eleves')).length, avant, 'aucun élève créé après un refus');
  assert.equal((await call(s.admin, 'POST', '/api/eleves', elevePayload(s, 'Test', 'Invalide', { nom: 'Parent', prenom: 'Quentin', email: 'pas-un-email' }))).status, 400);
});

test('mot de passe oublié : réponse identique pour un compte inconnu, e-mail envoyé seulement si le compte existe ; 5 mauvais codes bloquent le code', async () => {
  const s = E.A; const avant = mailer.sent.length;
  const r1 = await must(null, 'POST', '/api/auth/forgot-password', { email: `inconnu-${stamp}@nulle.part` });
  assert.equal(mailer.sent.length, avant);
  const r2 = await must(null, 'POST', '/api/auth/forgot-password', { email: s.parentMail });
  assert.deepEqual(r1, r2); assert.equal(mailer.sent.length, avant + 1);
  const code = codeDu(dernierMail(s.parentMail)) || /Code : ([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(dernierMail(s.parentMail).text)[1];
  for (let i = 0; i < 5; i++) assert.equal((await call(null, 'POST', '/api/auth/set-password', { email: s.parentMail, code: 'ZZZZZ-ZZZZZ', password: 'Nouveau@2026x' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/set-password', { email: s.parentMail, code, password: 'Nouveau@2026x' })).status, 400, 'code verrouillé après 5 échecs');
});

test('validation d\'une pré-inscription : le mot de passe temporaire n\'est jamais renvoyé à l\'administrateur, e-mail envoyé au parent', async () => {
  const s = E.A; const mail = `pre-${stamp}@famille.tn`;
  const pre = await must(null, 'POST', `/api/public/${s.slug}/preinscriptions`, { eleve_nom: 'Ferchichi', eleve_prenom: 'Sarra', date_naissance: '2018-03-04', parent_nom: 'Ferchichi', parent_prenom: 'Amel', parent_email: mail, consentement_rgpd: true });
  const v = await must(s.admin, 'POST', `/api/preinscriptions/${pre.id}/valider`, { classe_id: s.classeA });
  assert.equal(v.mot_de_passe_temporaire, undefined); assert.equal(v.email_envoye, true); assert.equal(v.compte_cree, true);
  const m = dernierMail(mail); const t = mdpTemp(m); assert.ok(t);
  assert.ok(!JSON.stringify(v).includes(t), "réponse API sans mot de passe");
  assert.match(m.text, /Sarra Ferchichi/); assert.match(m.text, /classe : 1ère année A/);
  assert.equal((await must(null, 'POST', '/api/auth/login', { email: mail, password: t })).user.must_change_password, true);
});

test('un parent ne peut pas créer d\'élève ni renvoyer d\'invitation', async () => {
  assert.equal((await call(E.A.parentTok, 'POST', '/api/eleves', elevePayload(E.A, 'X', 'Yy', { nom: 'Parent', prenom: 'Bilel', email: 'a@b.tn' }))).status, 403);
  assert.equal((await call(E.A.parentTok, 'POST', '/api/users/1/renvoyer-invitation')).status, 403);
});

// ====================== Emploi du temps : conflits ======================
const cr = (s, o) => ({ classe_id: s.classeA, matiere_id: s.matiere, enseignant_id: s.ensX, salle_id: s.salle1, jour: 1, heure_debut: '09:00', heure_fin: '10:00', ...o });

test('règle 2 : un enseignant ne peut pas avoir deux séances qui se chevauchent (classes différentes) — message précis + suggestions', async () => {
  const s = E.A;
  s.cr1 = (await must(s.admin, 'POST', '/api/creneaux', cr(s, {}))).id;
  const r = await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, salle_id: s.salle2, heure_debut: '09:30', heure_fin: '10:30' }));
  assert.equal(r.status, 409); assert.equal(r.data.code, 'conflit_edt');
  const c = r.data.conflits.find((x) => x.type === 'enseignant'); assert.ok(c);
  assert.match(c.message, /Sami Benali|Benali Sami/); assert.equal(c.jour_nom, 'lundi'); assert.equal(c.debut, '09:00'); assert.equal(c.fin, '10:00');
  assert.match(r.data.error, /lundi/); assert.match(r.data.error, /autre créneau ou une autre salle/);
  assert.ok(r.data.suggestions.creneaux.length > 0); assert.ok(r.data.suggestions.creneaux.every((x) => !(x.jour === 1 && x.debut < '10:00' && x.fin > '09:00')), 'suggestions sans chevauchement');
});

test('règle 1 : une salle ne peut pas servir à deux séances qui se chevauchent — la salle fautive est nommée', async () => {
  const s = E.A;
  const r = await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY, heure_debut: '08:30', heure_fin: '09:30' }));
  assert.equal(r.status, 409); const c = r.data.conflits.find((x) => x.type === 'salle');
  assert.ok(c); assert.match(c.message, /Salle 1/); assert.equal(c.debut, '09:00');
  assert.ok(r.data.suggestions.salles.some((x) => x.nom === 'Salle 2'), 'propose la salle libre');
  // même horaire exact (cas 08:00–09:00 de l'énoncé) dans la même salle, autre classe/enseignant
  assert.equal((await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY }))).status, 409);
});

test('séances bout à bout, autre jour ou autre salle : acceptées', async () => {
  const s = E.A;
  assert.equal((await call(s.admin, 'POST', '/api/creneaux', cr(s, { heure_debut: '10:00', heure_fin: '11:00' }))).status, 201, 'bout à bout');
  assert.equal((await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY, jour: 2 }))).status, 201, 'autre jour');
  assert.equal((await call(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY, salle_id: s.salle2 }))).status, 201, 'autre salle, autre enseignant');
});

test('les règles s\'appliquent aussi à la MODIFICATION d\'une séance (et une séance ne entre pas en conflit avec elle-même)', async () => {
  const s = E.A;
  const libre = (await must(s.admin, 'POST', '/api/creneaux', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY, salle_id: s.salle2, jour: 3, heure_debut: '14:00', heure_fin: '15:00' }))).id;
  await must(s.admin, 'PUT', `/api/creneaux/${libre}`, { heure_debut: '14:15', heure_fin: '15:15' }); // chevauche l'ancienne version de lui-même : accepté
  const r1 = await call(s.admin, 'PUT', `/api/creneaux/${libre}`, { jour: 1, heure_debut: '09:30', heure_fin: '10:30', enseignant_id: s.ensX });
  assert.equal(r1.status, 409); assert.ok(r1.data.conflits.some((c) => c.type === 'enseignant'));
  const r2 = await call(s.admin, 'PUT', `/api/creneaux/${libre}`, { jour: 1, heure_debut: '09:00', heure_fin: '10:00', salle_id: s.salle1 });
  assert.equal(r2.status, 409); assert.ok(r2.data.conflits.some((c) => c.type === 'salle'));
  const stable = (await must(s.admin, 'GET', '/api/creneaux')).find((c) => c.id === libre); assert.equal(stable.jour, 3, 'le créneau refusé n\'a pas été modifié');
});

test('pré-vérification (interface) : mêmes règles, rien n\'est enregistré', async () => {
  const s = E.A; const avant = (await must(s.admin, 'GET', '/api/creneaux')).length;
  const ko = await must(s.admin, 'POST', '/api/creneaux/verifier', cr(s, { classe_id: s.classeB, enseignant_id: s.ensY, heure_debut: '09:15', heure_fin: '09:45' }));
  assert.equal(ko.ok, false); assert.ok(ko.conflits.some((c) => c.type === 'salle'), 'conflit de salle'); assert.ok(ko.conflits.some((c) => c.type === 'enseignant'), 'conflit enseignant (Y occupé à 09:00)'); assert.ok(ko.suggestions);
  const ok = await must(s.admin, 'POST', '/api/creneaux/verifier', cr(s, { jour: 5 })); assert.equal(ok.ok, true);
  assert.equal((await must(s.admin, 'GET', '/api/creneaux')).length, avant);
});

test('concurrence : 8 créations simultanées du même enseignant sur le même créneau → une seule réussit', async () => {
  const s = E.A;
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => call(s.admin, 'POST', '/api/creneaux', cr(s, { jour: 6, heure_debut: '08:00', heure_fin: '09:00', classe_id: i % 2 ? s.classeA : s.classeB, salle_id: i % 2 ? s.salle1 : s.salle2 }))));
  assert.equal(res.filter((r) => r.status === 201).length, 1, JSON.stringify(res.map((r) => r.status)));
  assert.equal(res.filter((r) => r.status === 409).length, 7);
  const n = (await db.qa("SELECT COUNT(*)::int n FROM creneaux WHERE school_id=$1 AND jour=6 AND enseignant_id=$2 AND deleted_at IS NULL", [s.id, s.ensX])).rows[0].n; assert.equal(n, 1);
});

test('local partagé entre deux écoles du même site : refusé sans révéler l\'autre école ; accepté pour une école d\'un autre site', async () => {
  const [A, B, C] = [E.A, E.B, E.C];
  await must(A.admin, 'POST', '/api/creneaux', cr(A, { jour: 4, heure_debut: '08:00', heure_fin: '09:00', salle_id: A.salle1, classe_id: A.classeA, enseignant_id: A.ensX }));
  const r = await call(B.admin, 'POST', '/api/creneaux', cr(B, { jour: 4, heure_debut: '08:00', heure_fin: '09:00' }));
  assert.equal(r.status, 409); assert.equal(r.data.conflits[0].type, 'salle'); assert.equal(r.data.conflits[0].autre_etablissement, true);
  assert.ok(!JSON.stringify(r.data).includes(A.slug) && !JSON.stringify(r.data).includes(`École Mobile A`), 'aucune donnée de l\'autre école');
  assert.ok(!r.data.suggestions.salles.some((s) => s.nom === 'Salle 1'), 'ne propose pas la salle partagée occupée');
  assert.equal((await call(B.admin, 'POST', '/api/creneaux', cr(B, { jour: 4, heure_debut: '08:00', heure_fin: '09:00', salle_id: B.salle2 }))).status, 201, 'autre salle OK');
  assert.equal((await call(C.admin, 'POST', '/api/creneaux', cr(C, { jour: 4, heure_debut: '08:00', heure_fin: '09:00' }))).status, 201, 'autre site : aucun conflit');
  assert.equal((await call(B.admin, 'POST', '/api/creneaux', cr(B, { jour: 4, heure_debut: '08:30', heure_fin: '09:30', salle_id: B.salle1, enseignant_id: B.ensY, classe_id: B.classeB }))).status, 409, 'chevauchement partiel aussi');
});

// ====================== Loyers du propriétaire ======================
test('contrat + échéances : loyer PRÉVU ≠ loyer ENCAISSÉ ; un impayé n\'est jamais un revenu', async () => {
  const s = E.A; const debut = decaler(aujourdhui(), -3); const fin = finMois(decaler(aujourdhui(), -1));
  const c = await must(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: 1000, jour_echeance: 5, date_debut: debut, date_fin: fin, caution: 2000 });
  assert.equal(c.loyer_mensuel, 1000);
  let st = await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=0`).catch(() => null);
  const annees = new Set([Number(debut.slice(0, 4)), Number(fin.slice(0, 4))]);
  let echs = [];
  for (const a of annees) echs.push(...(await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${a}`)).echeances);
  assert.equal(echs.length, 3, '3 mois de contrat = 3 échéances'); assert.ok(echs.every((e) => e.statut === 'en_retard' && e.paye === 0));
  let tot = 0; for (const a of annees) tot += (await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${a}`)).totaux.encaisse;
  assert.equal(tot, 0, 'aucun revenu tant que rien n\'est encaissé');
  const imp = []; for (const a of annees) imp.push(...(await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${a}`)).retards);
  assert.equal(imp.length, 3); assert.ok(imp.every((r) => r.jours_retard > 0 && r.reste === 1000));
  s.echs = echs.sort((a, b) => a.periode.localeCompare(b.periode));
});

test('encaissements : partiel, complet, refus du trop-perçu / date future / référence manquante ; statuts et totaux cohérents', async () => {
  const s = E.A; const [e1, e2] = s.echs;
  assert.equal((await call(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 1500, mode: 'especes' })).status, 400, 'trop-perçu');
  assert.equal((await call(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 100, mode: 'especes', date_paiement: decaler(aujourdhui(), 2) })).status, 400, 'date future');
  assert.equal((await call(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 100, mode: 'virement' })).status, 400, 'référence obligatoire');
  const p1 = await must(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 400, mode: 'especes' }); assert.equal(p1.reste_apres, 600);
  await must(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 600, mode: 'virement', reference: 'VIR-001' });
  assert.equal((await call(sa, 'POST', `/api/saas/echeances/${e1.id}/encaissements`, { montant: 1, mode: 'especes' })).status, 409, 'déjà réglée');
  await must(sa, 'POST', `/api/saas/echeances/${e2.id}/encaissements`, { montant: 250, mode: 'cheque', reference: 'CH-77' });
  const annees = [...new Set(s.echs.map((e) => e.periode.slice(0, 4)))]; let enc = 0; let imp = 0; let payes = 0; let retard = 0; const hist = [];
  for (const a of annees) { const r = await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${a}`); enc += r.totaux.encaisse; imp += r.totaux.impaye; payes += r.totaux.nb_payees; retard += r.totaux.nb_en_retard; hist.push(...r.historique); }
  assert.equal(enc, 1250, 'encaissé = somme des versements réels'); assert.equal(imp, 1750, '3000 prévus − 1250 encaissés'); assert.equal(payes, 1); assert.equal(retard, 2);
  assert.equal(hist.length, 3); assert.ok(hist.every((h) => h.ecole && h.mode && h.date_paiement));
  const par = (await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${annees[0]}`)).par_ecole[0]; assert.equal(par.loyer_mensuel, 1000);
});

test('échéance future = « en attente » (pas en retard), listée dans les prochaines échéances ; filtres par école et par mois', async () => {
  const s = E.B; const prochain = decaler(aujourdhui(), 1);
  await must(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: 800, jour_echeance: 10, date_debut: prochain, date_fin: finMois(prochain) });
  const r = await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${prochain.slice(0, 4)}&mois=${Number(prochain.slice(5, 7))}`);
  assert.equal(r.echeances.length, 1); assert.equal(r.echeances[0].statut, 'en_attente'); assert.equal(r.totaux.impaye, 0); assert.equal(r.totaux.en_attente, 800); assert.equal(r.totaux.encaisse, 0);
  assert.ok(r.prochaines.some((p) => p.school_id === s.id && p.jours_restants > 0));
  const autre = await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${E.A.id}&annee=${prochain.slice(0, 4)}&mois=${Number(prochain.slice(5, 7))}`);
  assert.equal(autre.echeances.length, 0, 'le filtre école isole bien');
  assert.equal(r.mensuel.length, 12);
});

test('changer le loyer : les mois déjà payés ne changent pas, les mois sans versement suivent', async () => {
  const s = E.B; const prochain = decaler(aujourdhui(), 1);
  await must(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: 900, jour_echeance: 10, date_debut: prochain, date_fin: finMois(prochain) });
  const r = await must(sa, 'GET', `/api/saas/finance/stats?ecole_id=${s.id}&annee=${prochain.slice(0, 4)}&mois=${Number(prochain.slice(5, 7))}`);
  assert.equal(r.echeances[0].montant_du, 900);
  assert.equal((await call(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: -5, date_debut: prochain })).status, 400);
  assert.equal((await call(sa, 'PUT', `/api/saas/schools/${s.id}/contrat`, { loyer_mensuel: 5, date_debut: prochain, date_fin: decaler(prochain, -2) })).status, 400);
});

test('accueil propriétaire : totaux cohérents avec la base ; détail d\'une école ; activer/désactiver', async () => {
  const a = await must(sa, 'GET', '/api/saas/accueil');
  const reel = (await db.qa("SELECT (SELECT COUNT(*)::int FROM schools) ecoles, (SELECT COUNT(*)::int FROM eleves WHERE deleted_at IS NULL) eleves, (SELECT COUNT(*)::int FROM users WHERE role='enseignant' AND deleted_at IS NULL) ens, (SELECT COUNT(*)::int FROM users WHERE role='parent' AND deleted_at IS NULL) par")).rows[0];
  assert.deepEqual([a.totaux.ecoles, a.totaux.eleves, a.totaux.enseignants, a.totaux.parents], [reel.ecoles, reel.eleves, reel.ens, reel.par]);
  assert.ok(a.finance && a.ecoles.length === reel.ecoles);
  const d = await must(sa, 'GET', `/api/saas/schools/${E.A.id}`); assert.equal(d.contrat.loyer_mensuel, 1000); assert.ok(d.finance.par_ecole.length === 1); assert.ok(d.directeurs.length >= 1); assert.equal(d.ecole.site, `Site Test ${stamp}`);
  await must(sa, 'PUT', `/api/saas/schools/${E.C.id}`, { status: 'suspended' });
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: `dir-C-${stamp}@mob.tn`, password: PW })).status, 403, 'école désactivée : connexion refusée');
  await must(sa, 'PUT', `/api/saas/schools/${E.C.id}`, { status: 'active' });
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: `dir-C-${stamp}@mob.tn`, password: PW })).status, 200);
});

test('sécurité : les loyers sont invisibles pour les comptes d\'école (API et base de données)', async () => {
  for (const url of ['/api/saas/accueil', '/api/saas/finance/stats', `/api/saas/schools/${E.A.id}`]) {
    for (const tok of [E.A.admin, E.A.parentTok]) assert.equal((await call(tok, 'GET', url)).status, 403, url);
    assert.equal((await call(null, 'GET', url)).status, 401);
  }
  assert.equal((await call(E.A.admin, 'PUT', `/api/saas/schools/${E.A.id}/contrat`, { loyer_mensuel: 1, date_debut: aujourdhui() })).status, 403);
  assert.equal((await call(E.A.admin, 'POST', `/api/saas/echeances/${E.A.echs[2].id}/encaissements`, { montant: 1, mode: 'especes' })).status, 403);
  const priv = (await db.qa("SELECT has_table_privilege('ecole_app','school_contracts','select') a, has_table_privilege('ecole_app','loyer_encaissements','select') b, has_table_privilege('ecole_app','password_setup_tokens','select') c")).rows[0];
  assert.deepEqual([priv.a, priv.b, priv.c], [false, false, false]);
});

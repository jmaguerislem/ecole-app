// Tests : module « Business Intelligence & Aide à la décision » (10 tableaux de bord du directeur).
// École A : données construites à la main sur 3 années (résultats attendus calculés à la main dans les commentaires).
// École B : école vide (aucune division par zéro, aucune donnée venant de A). Droits : directeur uniquement.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const migrate = require('../src/migrate');
const db = require('../src/db');
const { app } = require('../src/index');

const PW = 'Test@2026x1'; const stamp = Date.now().toString(36);
const CUR = config.anneeCourante; const START = Number(CUR.slice(0, 4)); const PREV = `${START - 1}-${START}`; const PREV2 = `${START - 2}-${START - 1}`;
let base; let server; let sup; let A; let B; let idA; let idB; const ids = []; const X = {};
async function call(token, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const must = async (token, method, url, body) => { const r = await call(token, method, url, body); assert.ok(r.status < 300, `${method} ${url} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const login = async (email) => (await must(null, 'POST', '/api/auth/login', { email, password: PW })).token;
const bi = (token, nom, qs = '') => must(token, 'GET', `/api/bi/${nom}${qs}`);
const ins = async (schoolId, table, o) => {
  const k = Object.keys(o);
  const r = await db.qa(`INSERT INTO ${table}(${k.join(',')},school_id) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')},$${k.length + 1}) RETURNING *`, [...k.map((c) => o[c]), schoolId]);
  return r.rows[0].id;
};
const jour = (mois, j) => `${START}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
const ilYa = (jours) => new Date(Date.now() - jours * 86400000).toISOString();
const lundi = (semainesAvant) => { const d = new Date(Date.now() - semainesAvant * 7 * 86400000); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const plusJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const demain = () => { let d = plusJours(new Date().toISOString().slice(0, 10), 2); if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) d = plusJours(d, 1); return d; };

test.before(async () => {
  await migrate();
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Test',NULL)", [`sa-${stamp}@bi.test`, await bcrypt.hash(PW, 4)]);
  sup = await login(`sa-${stamp}@bi.test`);
  for (const k of ['A', 'B']) {
    const r = await must(sup, 'POST', '/api/saas/schools', { nom: `Bi${k} ${stamp}`, ville: `Ville${k}`, status: 'active', plan: 'premium', admin: { email: `dir-${k}-${stamp}@bi.test`, password: PW } });
    ids.push(r.id); if (k === 'A') idA = r.id; else idB = r.id;
  }
  A = await login(`dir-A-${stamp}@bi.test`); B = await login(`dir-B-${stamp}@bi.test`);
  const s = idA; const hash = await bcrypt.hash(PW, 4);
  const adminA = (await db.qa('SELECT id FROM users WHERE lower(email)=lower($1)', [`dir-A-${stamp}@bi.test`])).rows[0].id;

  // Classes : C1 (capacité 4, 5 élèves → surchargée), C2 (20), C3 (30, vide → sous-remplie), P1 (année précédente)
  const C1 = await ins(s, 'classes', { niveau: '1ère année', section: 'A', capacite: 4, annee_scolaire: CUR });
  const C2 = await ins(s, 'classes', { niveau: '2ème année', section: 'A', capacite: 20, annee_scolaire: CUR });
  await ins(s, 'classes', { niveau: '3ème année', section: 'A', capacite: 30, annee_scolaire: CUR });
  const P1 = await ins(s, 'classes', { niveau: '1ère année', section: 'A', capacite: 25, annee_scolaire: PREV });
  const el = (nom, classe, entree, statut = 'actif', adresse = null) => ins(s, 'eleves', { nom, prenom: 'Bi', classe_id: classe, annee_entree: entree, statut, adresse });
  X.s1 = await el('Risk', C1, PREV, 'actif', '12 rue X, Tunis'); X.s2 = await el('Good1', C1, PREV, 'actif', 'Tunis'); X.s3 = await el('Good2', C1, CUR, 'actif', '5 avenue Y, 2000 Ariana');
  X.s4 = await el('Limite4', C1, CUR); X.s5 = await el('Limite5', C1, CUR);
  X.s6 = await el('Deux6', C2, PREV2); X.s7 = await el('Deux7', C2, PREV2); X.s8 = await el('Deux8', C2, PREV);
  X.s9 = await el('SansClasse', null, CUR); X.s10 = await el('Parti', C2, PREV, 'inactif'); X.s11 = await el('Diplome', null, PREV2, 'diplome');
  // Matières et notes (mêmes valeurs dans les 2 matières → la moyenne pondérée vaut cette valeur)
  const maths = await ins(s, 'matieres', { nom: 'Maths', coefficient: 2 }); const fr = await ins(s, 'matieres', { nom: 'Français', coefficient: 1 });
  const notes = async (classe, annee, tri, valeurs) => {
    for (const m of [maths, fr]) {
      const ev = await ins(s, 'evaluations', { classe_id: classe, matiere_id: m, titre: `Contrôle T${tri}`, trimestre: tri, bareme: 20, annee_scolaire: annee });
      for (const [e, v] of valeurs) await ins(s, 'notes', { evaluation_id: ev, eleve_id: e, valeur: v, annee_scolaire: annee });
    }
  };
  await notes(C1, CUR, 1, [[X.s1, 6], [X.s2, 14], [X.s3, 12]]); await notes(C1, CUR, 2, [[X.s1, 4], [X.s2, 15], [X.s3, 13]]); // moyennes : 5 ; 14,5 ; 12,5 → générale 10,7
  await notes(P1, PREV, 1, [[X.s1, 10], [X.s2, 16]]); // année précédente : moyenne 13
  // Absences : Risk 4 jours non justifiés ; Good1 une demi-journée justifiée
  for (const j of [[10, 1], [10, 2], [10, 3], [10, 6]]) await ins(s, 'absences', { eleve_id: X.s1, date_absence: jour(...j), periode: 'journee', justifiee: false, annee_scolaire: CUR });
  await ins(s, 'absences', { eleve_id: X.s2, date_absence: jour(10, 7), periode: 'matin', justifiee: true, annee_scolaire: CUR });
  // Finances : scolarité 1ère année 500 TND (échéance dépassée depuis 100 jours) ; Good1 a payé 500, Good2 250 ; avant : Good1 400 l'an dernier
  const t1 = await ins(s, 'tarifs', { annee_scolaire: CUR, libelle: 'Scolarité – 1ère année', type: 'scolarite', niveau: '1ère année', montant: 500, echeance: ilYa(100).slice(0, 10) }); // échéance dépassée depuis 100 jours, quelle que soit la date du test
  await ins(s, 'tarifs', { annee_scolaire: CUR, libelle: "Frais d'inscription", type: 'inscription', niveau: '1ère année', montant: 100 });
  await ins(s, 'paiements', { eleve_id: X.s2, tarif_id: t1, montant: 500, mode: 'especes', date_paiement: jour(9, 10), annee_scolaire: CUR });
  await ins(s, 'paiements', { eleve_id: X.s3, tarif_id: t1, montant: 250, mode: 'virement', date_paiement: jour(10, 10), annee_scolaire: CUR });
  await ins(s, 'paiements', { eleve_id: X.s2, montant: 400, mode: 'especes', date_paiement: `${START - 1}-10-10`, annee_scolaire: PREV });
  // Enseignants, salles, emploi du temps (avec 3 conflits volontaires lundi)
  const ens = {}; for (const [k, nom] of [['e1', 'EnsUn'], ['e2', 'EnsDeux'], ['e3', 'EnsTrois']]) ens[k] = await ins(s, 'users', { email: `${k}-a-${stamp}@bi.test`, password_hash: hash, role: 'enseignant', nom, prenom: 'Bi' });
  const R1 = await ins(s, 'salles', { nom: 'R1', capacite: 25, disponible: true }); const R2 = await ins(s, 'salles', { nom: 'R2', capacite: 25, disponible: true }); await ins(s, 'salles', { nom: 'R3', capacite: 25, disponible: true });
  const cr = (classe, mat, e, salle, j, d, f) => ins(s, 'creneaux', { classe_id: classe, matiere_id: mat, enseignant_id: ens[e], salle_id: salle, jour: j, heure_debut: d, heure_fin: f, annee_scolaire: CUR });
  await cr(C1, maths, 'e1', R1, 1, '08:00', '10:00'); await cr(C2, fr, 'e1', R2, 1, '09:00', '11:00'); await cr(C1, maths, 'e1', R1, 2, '08:00', '10:00'); await cr(C1, fr, 'e2', R1, 1, '08:00', '10:00');
  // Parents et messages
  X.p1 = await ins(s, 'users', { email: `p1-a-${stamp}@bi.test`, password_hash: hash, role: 'parent', nom: 'ParentUn', prenom: 'Bi', telephone: '20111222' });
  X.p2 = await ins(s, 'users', { email: `p2-a-${stamp}@bi.test`, password_hash: hash, role: 'parent', nom: 'ParentDeux', prenom: 'Bi' });
  await ins(s, 'eleve_parents', { eleve_id: X.s1, parent_id: X.p1, lien: 'mere' }); await ins(s, 'eleve_parents', { eleve_id: X.s2, parent_id: X.p2, lien: 'pere' });
  const m1 = await ins(s, 'messages', { sender_id: adminA, objet: 'Réunion', corps: 'Bonjour', statut: 'envoye', sent_at: ilYa(10) });
  await ins(s, 'message_recipients', { message_id: m1, user_id: X.p1, read_at: null }); await ins(s, 'message_recipients', { message_id: m1, user_id: X.p2, read_at: ilYa(9) });
  await ins(s, 'messages', { sender_id: X.p1, objet: 'Question sur les notes', corps: 'Pouvez-vous me rappeler ?', statut: 'envoye', sent_at: ilYa(5) });
  // Retards d'arrivée : Deux6 5 fois (10 min), Deux7 une fois (20 min) → 6 retards, 70 minutes, 2 élèves, 1 retardataire récurrent
  for (const j of [[10, 1], [10, 2], [10, 3], [10, 6], [10, 7]]) await ins(s, 'retards', { eleve_id: X.s6, date_retard: jour(...j), minutes: 10, annee_scolaire: CUR });
  await ins(s, 'retards', { eleve_id: X.s7, date_retard: jour(10, 8), minutes: 20, justifie: true, annee_scolaire: CUR });
  // Absences d'enseignants : EnsUn lundi (journée, 4 h de cours) remplacé par EnsDeux ; EnsUn mardi matin (2 h) SANS remplaçant ;
  // EnsDeux lundi après-midi justifiée (0 h) ; EnsTrois dans 2-3 jours, sans remplaçant (à pourvoir)
  const l1 = lundi(1); const l2 = lundi(2);
  await ins(s, 'absences_enseignants', { enseignant_id: ens.e1, date_absence: l1, periode: 'journee', motif: 'Maladie', justifiee: true, remplacant_id: ens.e2, annee_scolaire: CUR });
  await ins(s, 'absences_enseignants', { enseignant_id: ens.e1, date_absence: plusJours(l2, 1), periode: 'matin', annee_scolaire: CUR });
  await ins(s, 'absences_enseignants', { enseignant_id: ens.e2, date_absence: l2, periode: 'apres_midi', justifiee: true, annee_scolaire: CUR });
  await ins(s, 'absences_enseignants', { enseignant_id: ens.e3, date_absence: demain(), periode: 'journee', annee_scolaire: CUR });
  // Réclamations : P1 ouverte depuis 10 jours (en retard) + en cours depuis 2 jours ; P2 résolue en 4 jours
  const rec = (parent, eleve, categorie, objet, statut, creeIlYa, resolueIlYa) => ins(s, 'reclamations', { parent_id: parent, eleve_id: eleve, categorie, objet, description: 'Description de la réclamation du parent.', statut,
    reponse: resolueIlYa ? 'Problème réglé.' : null, traite_par: resolueIlYa ? adminA : null, annee_scolaire: CUR, resolved_at: resolueIlYa ? ilYa(resolueIlYa) : null, created_at: ilYa(creeIlYa) });
  await rec(X.p1, X.s1, 'pedagogique', 'Notes de mon enfant', 'ouverte', 10); await rec(X.p1, X.s1, 'vie_scolaire', 'Cantine', 'en_cours', 2); await rec(X.p2, X.s2, 'financier', 'Erreur de facture', 'resolue', 6, 2);
  X.parentToken = await login(`p1-a-${stamp}@bi.test`);
});
test.after(async () => {
  const tables = (await db.qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 12; pass++) for (const t of tables) await db.qa(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [ids]).catch(() => {});
  await db.qa('DELETE FROM schools WHERE id = ANY($1)', [ids]).catch(() => {});
  await db.qa('DELETE FROM users WHERE email=$1', [`sa-${stamp}@bi.test`]).catch(() => {});
  await new Promise((r) => server.close(r)); await db.end();
});

test('droits : seul le directeur y accède ; un parent, un visiteur ou un tableau inconnu sont refusés', async () => {
  assert.equal((await call(null, 'GET', '/api/bi/general')).status, 401);
  assert.equal((await call(X.parentToken, 'GET', '/api/bi/general')).status, 403);
  assert.equal((await call(sup, 'GET', '/api/bi/general')).status, 403);
  assert.equal((await call(A, 'GET', '/api/bi/inconnu')).status, 404);
});

test('les 10 tableaux répondent pour l\'école A (riche) et pour l\'école B (vide), sans erreur', async () => {
  for (const nom of ['general', 'financier', 'pedagogique', 'absences', 'enseignants', 'inscriptions', 'communication', 'edt', 'risques', 'strategique']) {
    const a = await bi(A, nom); assert.equal(a.tableau, nom); assert.equal(a.annee, CUR); assert.ok(a.genere_le && Array.isArray(a.annees));
    const b = await bi(B, nom); assert.equal(b.tableau, nom);
  }
  const sim = await must(B, 'GET', '/api/bi/simulation?variation=10'); assert.equal(sim.simulation.effectif, 0);
});

test('1. général : effectifs, capacité, alertes de surcharge / sous-remplissage, évolution des inscriptions', async () => {
  const g = await bi(A, 'general');
  assert.deepEqual([g.kpis.eleves, g.kpis.classes, g.kpis.enseignants, g.kpis.parents, g.kpis.sans_classe], [9, 3, 3, 2, 1]);
  assert.deepEqual([g.kpis.capacite_totale, g.kpis.effectif_en_classe], [54, 8]);
  assert.deepEqual(g.classes.map((c) => [c.nom, c.effectif, c.capacite, c.statut]), [['1ère année A', 5, 4, 'surchargee'], ['2ème année A', 3, 20, 'sous_remplie'], ['3ème année A', 0, 30, 'sous_remplie']]);
  assert.ok(g.alertes.some((a) => a.type === 'surcharge' && a.classe === '1ère année A'));
  assert.deepEqual(g.evolution.map((e) => [e.annee, e.nouveaux, e.cumul]), [[PREV2, 3, 3], [PREV, 4, 7], [CUR, 4, 11]]);
});

test('2. financier : dû, encaissé, recouvrement, retards avec contact du parent, prévision', async () => {
  const f = await bi(A, 'financier');
  assert.deepEqual([f.kpis.attendu, f.kpis.encaisse, f.kpis.reste, f.kpis.taux_recouvrement, f.kpis.eleves_avec_retard], [3000, 750, 2250, 25, 5]);
  assert.equal(f.par_mois.reduce((t, m) => t + m.encaisse, 0), 750);
  assert.equal(f.par_mois.reduce((t, m) => t + m.annee_precedente, 0), 400, "paiements de l'année précédente");
  const risk = f.retards.find((r) => r.eleve === 'Bi Risk'); assert.equal(risk.solde, 600); assert.equal(risk.parents[0].telephone, '20111222');
  assert.ok(risk.jours_retard > 0, 'échéance dépassée');
  assert.deepEqual(f.par_mode.map((m) => [m.mode, m.total]).sort(), [['especes', 500], ['virement', 250]]);
  assert.ok(f.prevision.every((p) => p.prevu <= f.kpis.reste), 'la prévision ne dépasse jamais le reste à encaisser');
});

test('3. pédagogique : moyennes, réussite, difficultés, accompagnement', async () => {
  const p = await bi(A, 'pedagogique');
  assert.deepEqual([p.kpis.eleves_notes, p.kpis.moyenne_generale, p.kpis.taux_reussite, p.kpis.taux_echec, p.kpis.en_difficulte], [3, 10.7, 67, 33, 1]);
  assert.deepEqual(p.par_trimestre.map((t) => [t.trimestre, t.moyenne]), [[1, 10.7], [2, 10.7]]); // (6+14+12)/3 et (4+15+13)/3
  assert.deepEqual(p.par_matiere.map((m) => m.nom).sort(), ['Français', 'Maths']);
  assert.equal(p.en_difficulte[0].nom, 'Bi Risk'); assert.equal(p.en_difficulte[0].moyenne, 5);
  const acc = p.a_accompagner.find((x) => x.nom === 'Bi Risk'); assert.ok(acc.raisons.includes('Moyenne sous 10')); assert.ok(acc.raisons.some((r) => r.startsWith('Baisse')));
  assert.equal(p.par_classe.find((c) => c.nom === '1ère année A').taux_reussite, 67);
});

test('4. absences : taux, répétitives, relation avec les résultats', async () => {
  const a = await bi(A, 'absences');
  assert.deepEqual([a.kpis.jours_absence, a.kpis.nombre_absences, a.kpis.justifiees, a.kpis.non_justifiees, a.kpis.eleves_concernes, a.kpis.absences_repetitives], [4.5, 5, 1, 4, 2, 1]);
  assert.equal(a.repetitives[0].nom, 'Bi Risk'); assert.equal(a.repetitives[0].non_justifiees, 4);
  assert.equal(a.par_mois.reduce((t, m) => t + m.justifiees + m.non_justifiees, 0), 4.5);
  assert.equal(a.relation.eleves, 3); assert.ok(a.relation.correlation < 0, 'plus d’absences ↔ moyenne plus basse');
  assert.deepEqual([a.kpis.retards, a.kpis.minutes_retard, a.kpis.eleves_en_retard, a.kpis.retards_recurrents, a.kpis.retard_moyen_minutes], [6, 70, 2, 1, 11.7]);
  assert.deepEqual([a.retards.recurrents[0].nom, a.retards.recurrents[0].retards, a.retards.recurrents[0].minutes], ['Bi Deux6', 5, 50]);
  assert.equal(a.retards.par_mois.reduce((t, m) => t + m.retards, 0), 6); assert.equal(a.retards.par_classe.find((c) => c.nom === '2ème année A').retards, 6);
  assert.equal(a.non_suivi, undefined, 'plus de donnée « non suivie » : les retards d’arrivée sont enregistrés');
});

test('5. enseignants : charge horaire, surcharge, sous-charge', async () => {
  const e = await bi(A, 'enseignants');
  assert.deepEqual([e.kpis.enseignants, e.kpis.heures_totales, e.kpis.charge_moyenne, e.kpis.surcharge, e.kpis.sous_charge, e.kpis.sans_emploi_du_temps], [3, 8, 2.7, 1, 1, 1]);
  assert.deepEqual(e.enseignants.map((x) => [x.nom, x.heures, x.statut]), [['Bi EnsUn', 6, 'surcharge'], ['Bi EnsDeux', 2, 'equilibre'], ['Bi EnsTrois', 0, 'sous_charge']]);
  assert.equal(e.par_jour[0].heures, 6); // lundi : 2 + 2 + 2
  const ab = e.absences; // 3 absences passées : 1 journée + 2 demi-journées = 2 jours ; 1 absence à venir
  assert.deepEqual([ab.kpis.absences, ab.kpis.jours, ab.kpis.remplacees, ab.kpis.non_remplacees, ab.kpis.taux_remplacement, ab.kpis.enseignants_concernes, ab.kpis.recurrentes], [3, 2, 1, 2, 33, 2, 0]);
  assert.deepEqual([ab.kpis.heures_non_assurees, ab.kpis.heures_remplacees, ab.kpis.a_pourvoir, ab.kpis.absences_a_venir], [2, 4, 1, 1]);
  assert.ok(ab.kpis.taux_absenteisme > 0);
  const un = ab.par_enseignant.find((x) => x.nom === 'Bi EnsUn'); assert.deepEqual([un.absences, un.jours, un.non_remplacees], [2, 1.5, 1]);
  const deux = ab.par_enseignant.find((x) => x.nom === 'Bi EnsDeux'); assert.deepEqual([deux.absences, deux.remplacements, deux.heures_remplacees], [1, 1, 4]);
  assert.equal(ab.non_remplacees.find((x) => x.enseignant === 'Bi EnsUn').heures, 2); assert.equal(ab.a_venir[0].enseignant, 'Bi EnsTrois');
  assert.equal(e.non_suivi, undefined);
});

test('6. inscriptions : nouveaux, renouvellement, départs, origine, prévision', async () => {
  const i = await bi(A, 'inscriptions');
  assert.deepEqual([i.kpis.nouveaux, i.kpis.reinscrits, i.kpis.taux_renouvellement, i.kpis.departs, i.kpis.diplomes], [4, 5, 83, 1, 1]);
  assert.equal(i.cohortes.find((c) => c.annee === PREV).departs, 1);
  const o = Object.fromEntries(i.origine.map((x) => [x.label, x.value])); assert.equal(o.Tunis, 2); assert.equal(o.Ariana, 1);
  assert.equal(i.prevision.nouveaux_prevus, 5, 'tendance linéaire de 3, 4, 4 → 4,67 arrondi à 5');
});

test('7. communication : lecture, parents qui ne lisent pas, demandes sans réponse, suivi parental à renforcer', async () => {
  const c = await bi(A, 'communication');
  assert.deepEqual([c.kpis.messages_envoyes, c.kpis.destinataires, c.kpis.taux_lecture, c.kpis.parents_sans_lecture], [1, 2, 50, 1]);
  assert.equal(c.parents_sans_lecture[0].nom, 'Bi ParentUn');
  assert.deepEqual([c.kpis.demandes_parents, c.kpis.demandes_sans_reponse, c.kpis.demandes_en_retard], [1, 1, 1]);
  assert.deepEqual([c.kpis.reclamations, c.kpis.reclamations_ouvertes, c.kpis.reclamations_en_retard, c.kpis.reclamations_resolues, c.kpis.taux_resolution], [3, 2, 1, 1, 33]);
  assert.ok(c.kpis.delai_traitement_jours >= 3.9 && c.kpis.delai_traitement_jours <= 4.1, 'résolue en 4 jours');
  assert.deepEqual(c.reclamations.par_statut.map((x) => x.nombre), [1, 1, 1, 0]); assert.deepEqual(c.reclamations.par_categorie.map((x) => x.categorie).sort(), ['financier', 'pedagogique', 'vie_scolaire']);
  assert.deepEqual([c.reclamations.en_attente[0].objet, c.reclamations.en_attente[0].en_retard, c.reclamations.en_attente[1].en_retard], ['Notes de mon enfant', true, false]);
  assert.equal(c.non_suivi, undefined);
  const r = c.suivi_renforce.find((x) => x.eleve === 'Bi Risk'); assert.equal(r.constat, 'Aucun message lu'); assert.equal(r.telephone, '20111222');
});

test('8. emplois du temps : occupation des salles, conflits, équilibre', async () => {
  const t = await bi(A, 'edt');
  assert.deepEqual([t.kpis.creneaux, t.kpis.heures_hebdo, t.kpis.amplitude_hebdo, t.kpis.salles, t.kpis.conflits], [4, 8, 5, 3, 3]);
  assert.deepEqual(t.conflits.map((x) => x.type).sort(), ['classe', 'enseignant', 'salle']);
  const s = Object.fromEntries(t.salles.map((x) => [x.nom, x])); assert.deepEqual([s.R1.taux, s.R1.statut, s.R2.taux, s.R3.statut], [100, 'saturee', 40, 'sous_utilisee']);
  assert.equal(t.equilibre.find((e) => e.nom === '3ème année A').statut, 'sans_emploi_du_temps');
});

test('9. détection des risques : score expliqué, types, alertes avec action', async () => {
  const r = await bi(A, 'risques');
  assert.deepEqual([r.kpis.eleves_a_risque, r.kpis.risque_eleve, r.kpis.risque_faible, r.kpis.echec, r.kpis.abandon, r.kpis.impaye, r.kpis.double_risque], [4, 1, 3, 1, 1, 4, 1]);
  const x = r.eleves[0]; assert.equal(x.nom, 'Bi Risk'); assert.equal(x.score, 100); assert.equal(x.niveau, 'eleve'); assert.deepEqual(x.types.sort(), ['abandon', 'double', 'echec', 'impaye']);
  assert.ok(x.raisons.length >= 3 && x.raisons.some((t) => t.includes('absences non justifiées')));
  assert.equal(r.alertes[0].eleve, 'Bi Risk'); assert.ok(r.alertes[0].action.length > 10);
  assert.ok(r.regles.length >= 5, 'les règles sont exposées');
  assert.ok(!r.eleves.some((e) => e.nom === 'Bi Good1'), 'un élève sans risque n’est pas listé');
  const g2 = r.eleves.find((e) => e.nom === 'Bi Good2'); assert.equal(g2.score, 20, 'moitié impayée (15) + échéance dépassée de plus de 60 jours (5)'); assert.equal(g2.niveau, 'faible');
});

test('10. stratégique : prévision, besoins, scénarios, comparaison, recommandations, simulation', async () => {
  const s = await bi(A, 'strategique');
  assert.deepEqual([s.prevision.effectif_actuel, s.prevision.taux_renouvellement, s.prevision.effectif_prevu], [9, 83, 11]);
  assert.deepEqual(s.prevision.par_niveau.slice(0, 3).map((n) => n.prevu), [5, 4, 2]);
  assert.deepEqual(s.scenarios.map((x) => x.nom), ['Pessimiste', 'Prévision de base', 'Optimiste']);
  assert.ok(s.scenarios[0].effectif <= s.scenarios[1].effectif && s.scenarios[1].effectif <= s.scenarios[2].effectif);
  assert.equal(s.besoins.parametres.recouvrement, 25, 'le taux de recouvrement observé sert de base');
  assert.ok(s.non_suivi[0].includes('dépenses'), 'les dépenses sont annoncées comme estimées');
  assert.deepEqual(s.comparaison.map((c) => c.annee), [PREV2, PREV, CUR].filter((a) => s.annees.includes(a)));
  const cp = s.comparaison.find((c) => c.annee === PREV); assert.deepEqual([cp.moyenne, cp.taux_reussite, cp.encaisse, cp.nouveaux], [13, 100, 400, 4]);
  const titres = s.recommandations.map((r) => r.titre); assert.ok(titres.some((t) => t.includes('1ère année A est surchargée')));
  assert.ok(titres.some((t) => t.startsWith('Recouvrement faible : 25')) && titres.some((t) => t.includes('à risque élevé')) && titres.some((t) => t.includes("conflit(s) d'horaire")));
  assert.ok(titres.some((t) => t.includes("absence(s) d'enseignant à venir sans remplaçant")) && titres.some((t) => t.includes("absence(s) d'enseignant sans remplaçant")), 'absences d’enseignants');
  assert.ok(titres.some((t) => t.includes('réclamation(s) en attente depuis plus de 7 jours')) && titres.some((t) => t.includes('élève(s) souvent en retard')));
  assert.equal(s.recommandations[0].priorite, 'haute');
  // simulation : +20 % d'effectifs et paramètres bornés
  const sim = await must(A, 'GET', '/api/bi/simulation?variation=20&frais=10&cout_enseignant=1200');
  assert.ok(sim.simulation.effectif > sim.actuel.effectif && sim.simulation.recettes > sim.actuel.recettes);
  assert.equal(sim.simulation.parametres.cout_enseignant, 1200);
  const fou = await must(A, 'GET', '/api/bi/simulation?variation=99999&recouvrement=-5&frais=abc');
  assert.deepEqual([fou.simulation.parametres.variation, fou.simulation.parametres.recouvrement, fou.simulation.parametres.frais], [100, 0, 0]);
  // tarif suivant = 500 + augmentation automatique : 1ère année ; 11 élèves prévus … les recettes de base sont positives
  assert.ok(s.besoins.recettes > 0);
});

test('isolation : l\'école B ne voit rien de l\'école A', async () => {
  const g = await bi(B, 'general'); assert.deepEqual([g.kpis.eleves, g.kpis.classes, g.kpis.parents], [0, 0, 0]);
  const r = await bi(B, 'risques'); assert.equal(r.kpis.eleves_a_risque, 0);
  const f = await bi(B, 'financier'); assert.deepEqual([f.kpis.attendu, f.kpis.encaisse, f.retards.length], [0, 0, 0]);
  const c = await bi(B, 'communication'); assert.deepEqual([c.kpis.messages_envoyes, c.kpis.demandes_parents], [0, 0]);
  const e = await bi(B, 'edt'); assert.deepEqual([e.kpis.creneaux, e.kpis.conflits, e.kpis.salles], [0, 0, 0]);
});

// Enrichit les écoles de DÉMONSTRATION pour que les tableaux de bord « Aide à la décision » aient de quoi s'afficher :
// l'année précédente complète (3 trimestres de notes, absences, paiements), des devoirs surveillés supplémentaires, quelques élèves
// en difficulté, des absences réparties sur l'année, des messages aux parents (lus ou non) et des demandes de parents.
//   npm run seed:decisionnel
// Sans danger : n'AJOUTE que des lignes (aucun compte, aucune suppression), ne touche qu'aux écoles qui ont des élèves, et peut être
// relancé (une école déjà enrichie est ignorée). Les données sont déterministes (même résultat à chaque exécution).
// Le calendrier est respecté : rien n'est daté dans le futur (pas de trimestre 2 ou 3 de l'année en cours avant leur date).
const { qa, txa, end } = require('../db');
const config = require('../config');

const MARQUE = 'Devoir surveillé n°2 (démo BI)';
const CUR = config.anneeCourante; const START = Number(CUR.slice(0, 4)); const PREV = `${START - 1}-${START}`;
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clamp = (v, a = 0, b = 20) => Math.min(b, Math.max(a, v));
const r05 = (v) => Math.round(v * 2) / 2;
const iso = (d) => d.toISOString().slice(0, 10);
const jourOuvre = (d) => { const x = new Date(d); while (x.getUTCDay() === 0) x.setUTCDate(x.getUTCDate() + 1); return x; };

async function enrichir(school) {
  // tout ou rien : une erreur annule l'école entière, la commande peut être relancée (chaque partie a son propre repère « déjà fait »)
  return txa(async (cl) => { const a = await enrichirTx(cl, school); const b = await suiviTx(cl, school); return a || b ? { ...a, ...b } : null; });
}
async function enrichirTx(cl, school) {
  const qa = (text, p) => cl.query(text, p);
  const s = school.id; const R = rng(s * 7919 + 13);
  const ins = async (table, o) => {
    const k = Object.keys(o);
    const r = await qa(`INSERT INTO ${table}(${k.join(',')},school_id) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')},$${k.length + 1}) ON CONFLICT DO NOTHING RETURNING id`, [...k.map((c) => o[c]), s]);
    return r.rows[0]?.id;
  };
  if ((await qa('SELECT 1 FROM evaluations WHERE school_id=$1 AND titre=$2 LIMIT 1', [s, MARQUE])).rowCount) return null; // déjà fait
  const classes = (await qa('SELECT id, niveau, section, capacite FROM classes WHERE school_id=$1 AND annee_scolaire=$2 AND deleted_at IS NULL ORDER BY niveau, section', [s, CUR])).rows;
  const eleves = (await qa("SELECT id, classe_id, annee_entree FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='actif' AND classe_id IS NOT NULL ORDER BY id", [s])).rows;
  const matieres = (await qa('SELECT id FROM matieres WHERE school_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 4', [s])).rows;
  const admin = (await qa("SELECT id FROM users WHERE school_id=$1 AND role='admin' AND deleted_at IS NULL ORDER BY id LIMIT 1", [s])).rows[0];
  if (!classes.length || !eleves.length || !matieres.length) return null;
  const bilan = { evaluations: 0, notes: 0, absences: 0, paiements: 0, messages: 0 };

  // Niveau de chaque élève = sa moyenne actuelle (continuité avec les notes déjà saisies) ; quelques élèves en difficulté
  const moy = new Map((await qa(`SELECT n.eleve_id, AVG(n.valeur/ev.bareme*20) m FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id WHERE n.school_id=$1 AND n.annee_scolaire=$2 AND n.deleted_at IS NULL GROUP BY 1`, [s, CUR])).rows.map((x) => [x.eleve_id, Number(x.m)]));
  const fragiles = new Set(); const parClasse = [...new Set(eleves.map((e) => e.classe_id))];
  for (let i = 0; fragiles.size < Math.min(3, eleves.length) && i < 20; i++) { const c = parClasse[i % parClasse.length]; const cand = eleves.filter((e) => e.classe_id === c && !fragiles.has(e.id)); if (cand.length) fragiles.add(cand[Math.floor(R() * cand.length)].id); }
  const niveau = (id) => (fragiles.has(id) ? 5 + R() * 2 : (moy.get(id) ?? 10 + R() * 6));

  // 1) Devoirs surveillés supplémentaires du trimestre 1 (les élèves en difficulté y obtiennent de mauvais résultats)
  const debutT1 = `${START}-10-`; let jourEv = 0;
  for (const c of classes) for (const m of matieres) {
    const ev = await ins('evaluations', { classe_id: c.id, matiere_id: m.id, titre: MARQUE, trimestre: 1, date_eval: `${debutT1}${String(10 + (jourEv++ % 14)).padStart(2, '0')}`, bareme: 20, annee_scolaire: CUR, created_by: admin?.id ?? null });
    if (!ev) continue; bilan.evaluations++;
    for (const e of eleves.filter((x) => x.classe_id === c.id)) { if (await ins('notes', { evaluation_id: ev, eleve_id: e.id, valeur: r05(clamp(niveau(e.id) + (R() - 0.5) * 3)), annee_scolaire: CUR })) bilan.notes++; }
  }

  // 2) Année précédente : classes, 3 trimestres de notes, absences, paiements (mêmes élèves, résultats un peu différents)
  const prevClasse = new Map();
  for (const c of classes) prevClasse.set(c.id, await ins('classes', { niveau: c.niveau, section: c.section, capacite: c.capacite, annee_scolaire: PREV }));
  const inscrits = eleves.filter((e) => !e.annee_entree || e.annee_entree < CUR); // ceux qui étaient déjà là l'an dernier
  for (const [c, pc] of prevClasse) {
    if (!pc) continue;
    for (const tri of [1, 2, 3]) for (const m of matieres) {
      const ev = await ins('evaluations', { classe_id: pc, matiere_id: m.id, titre: `Contrôle T${tri} (démo BI)`, trimestre: tri, date_eval: `${START - 1}-${['11', '02', '05'][tri - 1]}-15`, bareme: 20, annee_scolaire: PREV, created_by: admin?.id ?? null });
      if (!ev) continue; bilan.evaluations++;
      for (const e of inscrits.filter((x) => x.classe_id === c)) if (await ins('notes', { evaluation_id: ev, eleve_id: e.id, valeur: r05(clamp(niveau(e.id) - 0.5 + (tri - 2) * 0.4 + (R() - 0.5) * 4)), annee_scolaire: PREV })) bilan.notes++;
    }
  }
  const tarifsPrev = (await qa("SELECT id, niveau, montant FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2 AND type='scolarite' AND deleted_at IS NULL", [s, PREV])).rows;
  for (const e of inscrits) {
    for (let k = 0; k < 4; k++) { const d = new Date(Date.UTC(START - 1, 8 + k * 2, 5 + Math.floor(R() * 15))); if (await ins('absences', { eleve_id: e.id, date_absence: iso(jourOuvre(d)), periode: 'journee', justifiee: R() < 0.5, annee_scolaire: PREV })) bilan.absences++; if (R() < 0.5) break; }
    const niv = classes.find((c) => c.id === e.classe_id)?.niveau; const t = tarifsPrev.find((x) => x.niveau === niv); const montant = t ? Math.round(Number(t.montant) * (R() < 0.85 ? 1 : 0.7)) : 0;
    if (montant > 0) for (let k = 0; k < 3; k++) if (await ins('paiements', { eleve_id: e.id, tarif_id: t.id, montant: Math.round(montant / 3), mode: ['especes', 'virement', 'mobile_money'][Math.floor(R() * 3)], date_paiement: `${START - 1}-${['09', '12', '03'][k]}-${String(8 + Math.floor(R() * 15)).padStart(2, '0')}`, annee_scolaire: PREV })) bilan.paiements++;
  }

  // 3) Absences de l'année en cours, réparties depuis septembre (jamais dans le futur ni un dimanche)
  const dernier = new Date(`${today}T12:00:00Z`);
  const dateAleatoire = () => { const debut = Date.UTC(START, 8, 8); const fin = dernier.getTime() - 86400000; return iso(jourOuvre(new Date(debut + R() * Math.max(1, fin - debut)))); };
  for (const e of eleves) {
    const n = fragiles.has(e.id) ? 4 + Math.floor(R() * 3) : (R() < 0.3 ? 1 + Math.floor(R() * 2) : 0);
    for (let k = 0; k < n; k++) { const d = dateAleatoire(); if (d > today) continue; if (await ins('absences', { eleve_id: e.id, date_absence: d, periode: R() < 0.7 ? 'journee' : 'matin', justifiee: !fragiles.has(e.id) && R() < 0.5, annee_scolaire: CUR })) bilan.absences++; }
  }

  // 4) Quelques élèves de niveau avancé sont entrés avant l'an dernier : l'évolution des inscriptions couvre plusieurs années
  // (niveaux « 3ème année » et plus : comparaison alphabétique des libellés)
  const anciens = eleves.filter((e) => classes.find((c) => c.id === e.classe_id)?.niveau >= '3').slice(0, 8).map((e) => e.id);
  if (anciens.length) await qa('UPDATE eleves SET annee_entree=$1 WHERE id = ANY($2) AND school_id=$3 AND (annee_entree IS NULL OR annee_entree >= $4)', [`${START - 2}-${START - 1}`, anciens, s, PREV]);

  // 5) Messages aux parents (certains lus, d'autres jamais) et demandes de parents
  const parents = (await qa("SELECT DISTINCT u.id FROM users u JOIN eleve_parents ep ON ep.parent_id=u.id WHERE u.school_id=$1 AND u.role='parent' AND u.deleted_at IS NULL ORDER BY u.id", [s])).rows.map((x) => x.id);
  const jamais = new Set(parents.filter(() => R() < 0.2));
  if (admin && parents.length) {
    for (const [objet, corps, ilYa] of [['Réunion parents-professeurs', 'Une réunion aura lieu le samedi prochain à 10h.', 50], ['Sortie pédagogique', 'Merci de renvoyer l’autorisation signée.', 30], ['Rappel de paiement', 'Nous vous rappelons les échéances de scolarité.', 12]]) {
      const sent = new Date(Date.now() - ilYa * 86400000); const m = await ins('messages', { sender_id: admin.id, objet, corps, statut: 'envoye', sent_at: sent.toISOString() }); if (!m) continue; bilan.messages++;
      for (const p of parents) await ins('message_recipients', { message_id: m, user_id: p, read_at: jamais.has(p) || R() < 0.3 ? null : new Date(sent.getTime() + R() * 3 * 86400000).toISOString() });
    }
    const demandes = [['Question sur les notes de mon enfant', 9, true], ['Demande de rendez-vous', 6, false], ['Justificatif d’absence', 1, false]];
    for (const [i, [objet, ilYa, repondue]] of demandes.entries()) {
      const p = parents[i % parents.length]; const sent = new Date(Date.now() - ilYa * 86400000);
      const m = await ins('messages', { sender_id: p, objet, corps: 'Bonjour, pouvez-vous me répondre ? Merci.', statut: 'envoye', sent_at: sent.toISOString() }); if (!m) continue; bilan.messages++;
      if (repondue) await ins('messages', { sender_id: admin.id, thread_id: m, objet: `Re: ${objet}`, corps: 'Bonjour, nous revenons vers vous rapidement.', statut: 'envoye', sent_at: new Date(sent.getTime() + 20 * 3600000).toISOString() });
    }
  }
  return bilan;
}

// Retards d'arrivée, absences / remplacements des enseignants et réclamations des parents (déjà fait si l'école a des absences d'enseignants)
async function suiviTx(cl, school) {
  const qa = (text, p) => cl.query(text, p);
  const s = school.id; const R = rng(s * 104729 + 7); const pick = (t) => t[Math.floor(R() * t.length)];
  const ins = async (table, o) => {
    const k = Object.keys(o);
    const r = await qa(`INSERT INTO ${table}(${k.join(',')},school_id) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')},$${k.length + 1}) ON CONFLICT DO NOTHING RETURNING id`, [...k.map((c) => o[c]), s]);
    return r.rows[0]?.id;
  };
  if ((await qa('SELECT 1 FROM absences_enseignants WHERE school_id=$1 LIMIT 1', [s])).rowCount) return null;
  const eleves = (await qa("SELECT id FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='actif' AND classe_id IS NOT NULL ORDER BY id", [s])).rows;
  const profs = (await qa("SELECT id FROM users WHERE school_id=$1 AND role='enseignant' AND deleted_at IS NULL AND actif ORDER BY id", [s])).rows.map((x) => x.id);
  const admin = (await qa("SELECT id FROM users WHERE school_id=$1 AND role='admin' AND deleted_at IS NULL ORDER BY id LIMIT 1", [s])).rows[0];
  if (!eleves.length || !profs.length) return null;
  const bilan = { retards: 0, absences_enseignants: 0, reclamations: 0 };
  const debut = Date.UTC(START, 8, 8); const hier = new Date(`${today}T12:00:00Z`).getTime() - 86400000;
  const datePassee = () => iso(jourOuvre(new Date(debut + R() * Math.max(1, hier - debut))));
  const dans = (n) => iso(jourOuvre(new Date(new Date(`${today}T12:00:00Z`).getTime() + n * 86400000)));

  // 1) Retards d'arrivée : un tiers des élèves en ont 1 à 3, quelques retardataires fréquents (5 à 8) ; jamais un jour où l'élève est absent toute la journée
  const absJournee = new Set((await qa("SELECT eleve_id||'|'||date_absence::text k FROM absences WHERE school_id=$1 AND periode='journee' AND deleted_at IS NULL", [s])).rows.map((x) => x.k));
  const frequents = new Set(eleves.filter(() => R() < 0.08).map((e) => e.id)); for (const e of eleves.slice(0, 2)) frequents.add(e.id);
  for (const e of eleves) {
    const nb = frequents.has(e.id) ? 5 + Math.floor(R() * 4) : (R() < 0.35 ? 1 + Math.floor(R() * 3) : 0);
    for (let k = 0; k < nb; k++) {
      const d = datePassee(); if (d >= today || absJournee.has(`${e.id}|${d}`)) continue;
      if (await ins('retards', { eleve_id: e.id, date_retard: d, minutes: 5 + 5 * Math.floor(R() * 5), motif: R() < 0.4 ? pick(['Problème de transport', 'Rendez-vous médical', 'Panne de voiture']) : null, justifie: R() < 0.2, annee_scolaire: CUR })) bilan.retards++;
    }
  }

  // 2) Absences d'enseignants : un enseignant souvent absent, des remplaçants pour environ 60 % des absences passées, et des absences à venir
  const prises = new Set(); const remplacants = new Set(); // 'enseignant|date' déjà absent ; 'enseignant|date' déjà désigné comme remplaçant
  const creer = async (p, d, remplacantVoulu) => {
    if (prises.has(`${p}|${d}`) || remplacants.has(`${p}|${d}`)) return;
    const cand = profs.filter((x) => x !== p && !prises.has(`${x}|${d}`));
    const remp = remplacantVoulu && cand.length ? pick(cand) : null;
    if (await ins('absences_enseignants', { enseignant_id: p, date_absence: d, periode: pick(['journee', 'journee', 'matin', 'apres_midi']), motif: pick(['Maladie', 'Formation', 'Raison familiale']), justifiee: R() < 0.7, remplacant_id: remp, annee_scolaire: CUR })) {
      prises.add(`${p}|${d}`); if (remp) remplacants.add(`${remp}|${d}`); bilan.absences_enseignants++;
    }
  };
  const passees = Math.min(8, profs.length * 2 + 1);
  for (let i = 0; i < passees; i++) await creer(i < 3 ? profs[0] : pick(profs), datePassee(), R() < 0.6);
  await creer(profs[Math.min(1, profs.length - 1)], dans(3), true); await creer(profs[Math.min(2, profs.length - 1)], dans(6), false);

  // 3) Réclamations de parents : ouvertes (dont une en retard), en cours, résolues (avec délai) et une rejetée
  const liens = (await qa("SELECT ep.parent_id, MIN(ep.eleve_id) eleve_id FROM eleve_parents ep JOIN users u ON u.id=ep.parent_id WHERE u.school_id=$1 AND u.role='parent' AND u.deleted_at IS NULL GROUP BY ep.parent_id ORDER BY ep.parent_id", [s])).rows;
  if (admin && liens.length) {
    const plan = [
      ['pedagogique', 'Notes de mon enfant', 'ouverte', 10, null], ['vie_scolaire', 'Problème à la cantine', 'ouverte', 3, null], ['administratif', 'Certificat de scolarité', 'en_cours', 5, null],
      ['financier', 'Erreur sur la facture', 'resolue', 12, 4], ['pedagogique', 'Demande de rendez-vous avec l’enseignant', 'resolue', 7, 2], ['vie_scolaire', 'Transport scolaire', 'rejetee', 15, 3],
    ];
    for (const [i, [categorie, objet, statut, age, delai]] of plan.entries()) {
      const l = liens[i % liens.length]; const cree = new Date(Date.now() - age * 86400000); const close = delai ? new Date(cree.getTime() + delai * 86400000) : null;
      if (await ins('reclamations', { parent_id: l.parent_id, eleve_id: l.eleve_id, categorie, objet, description: `${objet} : je souhaiterais des explications et une solution rapide. Merci de votre aide.`, statut,
        reponse: close ? (statut === 'rejetee' ? 'Ce service n’est pas assuré par l’école cette année.' : 'Le problème a été examiné et corrigé. Merci pour votre signalement.') : null, traite_par: close || statut === 'en_cours' ? admin.id : null,
        annee_scolaire: CUR, resolved_at: close ? close.toISOString() : null, updated_at: close ? close.toISOString() : null, created_at: cree.toISOString() })) bilan.reclamations++;
    }
  }
  return bilan;
}

async function main() {
  const ecoles = (await qa('SELECT s.id, s.nom FROM schools s WHERE EXISTS (SELECT 1 FROM eleves e WHERE e.school_id=s.id) ORDER BY s.id')).rows;
  for (const e of ecoles) {
    try { const b = await enrichir(e); console.log(b ? `[décisionnel] ${e.nom} : ${JSON.stringify(b)}` : `[décisionnel] ${e.nom} : rien à faire`); } catch (err) { console.error(`[décisionnel] ${e.nom} : ${err.message}`); }
  }
}
if (require.main === module) main().then(() => end()).catch((e) => { console.error(e); process.exit(1); });
module.exports = { enrichir };

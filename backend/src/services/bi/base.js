// Module « Business Intelligence & Aide à la décision » – socle commun.
// Tout est calculé en base à chaque appel, avec `q` (rôle restreint + Row Level Security) : le directeur ne peut calculer
// que sur les données de SON école. Aucune écriture n'est faite ici (lecture seule).
//
// Principes de transparence (important pour une aide à la décision) :
//  - chaque indicateur « calculé » (risque, prévision, recommandation) repose sur des règles simples, listées dans la réponse
//    (`regles` / `methode`) et affichées à l'écran : aucun score opaque ;
//  - quand une donnée n'est pas enregistrée par l'application (dépenses, retards d'arrivée, absences d'enseignants…), on le dit
//    (`non_suivi`) au lieu de l'inventer.
const { q } = require('../../db');
const config = require('../../config');
const V = require('../validate');
const { aujourdhui } = require('../absences');
const { assurerTarifsAnnee } = require('../tarifs');

const n = (v) => Number(v || 0);
const r1 = (v) => Math.round(Number(v || 0) * 10) / 10;
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const moyenne = (t) => (t.length ? t.reduce((s, x) => s + x, 0) / t.length : null);
const debut = (a) => Number(String(a).slice(0, 4));
const anneeDe = (d) => `${d}-${d + 1}`;
const rows = async (sql, p) => (await q(sql, p)).rows;
const nomClasse = (c) => `${c.niveau}${c.section ? ` ${c.section}` : ''}`;
const ordreNiveau = (nv) => { const i = V.NIVEAUX.indexOf(nv); return i < 0 ? 99 : i; };

// Seuils et règles (une seule définition, renvoyée au client pour être affichée)
const SEUILS = {
  surcharge_classe: 1.0, saturation_classe: 0.9, sous_remplie_classe: 0.5,
  moyenne_echec: 10, moyenne_alerte: 11, baisse_notable: 2,
  absences_repetitives: 3, // absences non justifiées dans l'année
  recouvrement_faible: 70, echec_eleve: 25, absenteisme_eleve: 8,
  surcharge_enseignant: 1.25, sous_charge_enseignant: 0.6, // rapport à la charge moyenne
  salle_sous_utilisee: 30, salle_saturee: 90, // % d'occupation
  lecture_faible: 50, // % de messages lus
  reponse_parent_jours: 3,
  retards_recurrents: 3, // retards d'arrivée dans l'année
  reclamation_jours: 7, // une réclamation non résolue depuis plus de 7 jours est « en retard »
  absences_enseignant_recurrentes: 3,
};

// Mois (YYYY-MM) de l'année scolaire « 2026-2027 » : septembre … août
function moisAnnee(annee) {
  const d = debut(annee); const out = [];
  for (let i = 0; i < 12; i++) { const m = ((8 + i) % 12) + 1; out.push(`${m >= 9 ? d : d + 1}-${String(m).padStart(2, '0')}`); }
  return out;
}
const moisLabel = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
function joursOuvres(d1, d2) { // lundi→samedi, bornes incluses (l'école est fermée le dimanche)
  let c = 0;
  for (const d = new Date(`${d1}T12:00:00Z`); d.toISOString().slice(0, 10) <= d2; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) c++;
  return c;
}

// Régression linéaire simple (moindres carrés) et corrélation de Pearson
function regression(ys) {
  const N = ys.length; if (N < 2) return null;
  const mx = (N - 1) / 2; const my = moyenne(ys);
  let sxy = 0; let sxx = 0;
  ys.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
  const pente = sxx ? sxy / sxx : 0;
  return { pente, ordonnee: my - pente * mx };
}
// Valeurs suivantes d'une série. `fiable` = au moins 3 points ; sinon on prolonge la dernière valeur / la moyenne.
function prevoir(ys, pas = 1) {
  if (!ys.length) return { valeurs: Array(pas).fill(0), fiable: false };
  const reg = ys.length >= 3 ? regression(ys) : null;
  const valeurs = Array.from({ length: pas }, (_, i) => Math.max(0, reg ? reg.ordonnee + reg.pente * (ys.length + i) : moyenne(ys)));
  return { valeurs, fiable: ys.length >= 3, pente: reg ? reg.pente : null };
}
function correlation(xs, ys) {
  const N = xs.length; if (N < 3) return null;
  const mx = moyenne(xs); const my = moyenne(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < N; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Contexte d'un calcul : année, date du jour, et cache des chargements partagés (une seule lecture par requête HTTP)
function contexte(annee) {
  const a = annee ? V.annee(annee) : config.anneeCourante;
  return { annee: a, precedente: anneeDe(debut(a) - 1), suivante: anneeDe(debut(a) + 1), aujourdhui: aujourdhui(), m: {} };
}
const memo = (ctx, k, fn) => (ctx.m[k] ||= fn());

async function anneesDisponibles(ctx) {
  const r = await rows(`SELECT annee_scolaire a FROM classes WHERE deleted_at IS NULL
    UNION SELECT annee_scolaire FROM notes WHERE deleted_at IS NULL UNION SELECT annee_scolaire FROM paiements WHERE deleted_at IS NULL
    UNION SELECT annee_scolaire FROM absences WHERE deleted_at IS NULL UNION SELECT annee_entree FROM eleves WHERE deleted_at IS NULL AND annee_entree IS NOT NULL`);
  const set = new Set(r.map((x) => x.a).filter((a) => /^\d{4}-\d{4}$/.test(a || ''))); set.add(ctx.annee); set.add(config.anneeCourante);
  return [...set].sort().reverse();
}

// ---------- Chargements partagés ----------
const elevesActifs = (ctx) => memo(ctx, 'eleves', async () => (await rows(
  `SELECT e.id, e.nom, e.prenom, e.classe_id, e.annee_entree, e.adresse, c.niveau, c.section, c.capacite
   FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id AND c.deleted_at IS NULL
   WHERE e.deleted_at IS NULL AND e.statut='actif' ORDER BY e.nom, e.prenom`)).map((e) => ({ ...e, classe: e.niveau ? nomClasse(e) : null })));

const classesAnnee = (ctx) => memo(ctx, 'classes', async () => (await rows(
  `SELECT c.id, c.niveau, c.section, c.capacite, c.titulaire_id,
     (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='actif') effectif
   FROM classes c WHERE c.deleted_at IS NULL AND c.annee_scolaire=$1`, [ctx.annee]))
  .map((c) => ({ ...c, nom: nomClasse(c) })).sort((a, b) => ordreNiveau(a.niveau) - ordreNiveau(b.niveau) || String(a.section || '').localeCompare(String(b.section || ''))));

// Notes ramenées sur 20. Moyenne d'un trimestre = moyenne des matières pondérée par leurs coefficients ;
// moyenne de l'année = moyenne des trimestres disponibles.
const notes = (ctx, annee = ctx.annee) => memo(ctx, `notes:${annee}`, async () => {
  const l = await rows(
    `SELECT n.eleve_id, ev.classe_id, ev.matiere_id, m.nom matiere, m.coefficient coef, ev.trimestre, AVG(n.valeur/ev.bareme*20) moy
     FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id JOIN matieres m ON m.id=ev.matiere_id JOIN eleves e ON e.id=n.eleve_id
     WHERE n.deleted_at IS NULL AND ev.deleted_at IS NULL AND e.deleted_at IS NULL AND n.annee_scolaire=$1
     GROUP BY 1,2,3,4,5,6`, [annee]);
  const par = new Map();
  for (const x of l) {
    const e = par.get(x.eleve_id) || { id: x.eleve_id, classe_id: x.classe_id, t: {}, mat: {} };
    (e.t[x.trimestre] ||= []).push(x); (e.mat[x.matiere] ||= []).push(x.moy); par.set(x.eleve_id, e);
  }
  for (const e of par.values()) {
    e.trimestres = Object.fromEntries(Object.entries(e.t).map(([t, arr]) => [t, arr.reduce((s, x) => s + x.moy * x.coef, 0) / arr.reduce((s, x) => s + x.coef, 0)]));
    const ts = Object.keys(e.trimestres).sort(); e.moyenne = moyenne(ts.map((t) => e.trimestres[t]));
    e.delta = ts.length >= 2 ? e.trimestres[ts[ts.length - 1]] - e.trimestres[ts[0]] : null; // évolution premier → dernier trimestre
    e.matieres = Object.fromEntries(Object.entries(e.mat).map(([k, v]) => [k, moyenne(v)]));
  }
  return { lignes: l, eleves: par };
});

// Absences en « jours » (journée = 1, demi-journée = 0,5)
const absences = (ctx, annee = ctx.annee) => memo(ctx, `abs:${annee}`, async () => {
  const l = await rows(
    `SELECT eleve_id, COUNT(*) nb, SUM(CASE periode WHEN 'journee' THEN 1 ELSE 0.5 END) jours,
       COUNT(*) FILTER (WHERE NOT justifiee) nj, COALESCE(SUM(CASE periode WHEN 'journee' THEN 1 ELSE 0.5 END) FILTER (WHERE NOT justifiee),0) jours_nj,
       COUNT(*) FILTER (WHERE justifiee) nj_just, MAX(date_absence) derniere
     FROM absences WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1`, [annee]);
  return new Map(l.map((x) => [x.eleve_id, { nb: n(x.nb), jours: n(x.jours), nj: n(x.nj), jours_nj: n(x.jours_nj), justifiees: n(x.nj_just), derniere: x.derniere }]));
});

// Retards d'arrivée des élèves (année en cours)
const retards = (ctx, annee = ctx.annee) => memo(ctx, `retards:${annee}`, async () => {
  const l = await rows(`SELECT eleve_id, COUNT(*) nb, COALESCE(SUM(minutes),0) minutes, COUNT(*) FILTER (WHERE justifie) just, MAX(date_retard) dernier
    FROM retards WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1`, [annee]);
  return new Map(l.map((x) => [x.eleve_id, { nb: n(x.nb), minutes: n(x.minutes), justifies: n(x.just), dernier: x.dernier }]));
});

const parents = (ctx) => memo(ctx, 'parents', async () => {
  const l = await rows(`SELECT ep.eleve_id, u.id, u.nom, u.prenom, u.telephone, u.email FROM eleve_parents ep JOIN users u ON u.id=ep.parent_id WHERE u.deleted_at IS NULL AND u.actif`);
  const m = new Map(); for (const p of l) (m.get(p.eleve_id) || m.set(p.eleve_id, []).get(p.eleve_id)).push({ id: p.id, nom: `${p.prenom} ${p.nom}`, telephone: p.telephone, email: p.email });
  return m;
});

// Montants dus / payés par élève actif (mêmes règles que le module Finance) + tarifs à échéance pour mesurer le retard
const soldes = (ctx) => memo(ctx, 'soldes', async () => {
  if (ctx.annee === config.anneeCourante) await assurerTarifsAnnee(ctx.annee); // même préparation que le tableau de bord financier
  const tarifs = await rows("SELECT id, type, niveau, montant, echeance FROM tarifs WHERE deleted_at IS NULL AND annee_scolaire=$1 ORDER BY echeance NULLS LAST, id", [ctx.annee]);
  const paye = new Map((await rows('SELECT eleve_id, SUM(montant) s FROM paiements WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1', [ctx.annee])).map((x) => [x.eleve_id, n(x.s)]));
  const out = new Map();
  for (const e of await elevesActifs(ctx)) {
    const app = tarifs.filter((t) => !t.niveau || t.niveau === '' || t.niveau === e.niveau);
    const du = app.reduce((s, t) => s + n(t.montant), 0); const p = paye.get(e.id) || 0;
    // retard : on impute les paiements aux tarifs dans l'ordre des échéances ; premier tarif échu non couvert
    let reste = p; let retardDepuis = null;
    for (const t of app.filter((x) => x.echeance).sort((a, b) => String(a.echeance).localeCompare(String(b.echeance)))) {
      const couvert = Math.min(reste, n(t.montant)); reste -= couvert;
      if (couvert < n(t.montant) - 0.005 && t.echeance <= ctx.aujourdhui) { retardDepuis = t.echeance; break; }
    }
    const jours = retardDepuis ? Math.max(0, Math.round((new Date(`${ctx.aujourdhui}T12:00:00Z`) - new Date(`${retardDepuis}T12:00:00Z`)) / 86400000)) : null;
    out.set(e.id, { du: r2(du), paye: r2(p), solde: r2(Math.max(0, du - p)), ratio: du > 0 ? Math.max(0, du - p) / du : 0, jours_retard: jours });
  }
  return out;
});

// ---------- Détection des risques (Early Warning System) : règles simples, additives et explicables ----------
const REGLES_RISQUE = [
  'Échec : moyenne annuelle < 8 → +45 pts ; < 10 → +30 ; < 11 → +10. Au moins 3 matières < 8 → +10. Baisse ≥ 2 points entre le premier et le dernier trimestre → +15.',
  "Assiduité : ≥ 5 absences non justifiées → +25 ; ≥ 3 → +15. Au moins 8 jours d'absence au total → +10. Retards d'arrivée : ≥ 10 → +10 ; ≥ 5 → +5.",
  'Impayés : reste dû ≥ 75 % du montant → +25 ; ≥ 50 % → +15 ; ≥ 25 % → +5. Retard de plus de 60 jours sur une échéance → +5.',
  'Double risque : absences répétées ET (moyenne < 10 ou baisse ≥ 1,5 point) → +15.',
  'Niveau de risque : score ≥ 60 = élevé, ≥ 35 = moyen, ≥ 20 = faible (maximum 100).',
  'Type « abandon » : absences répétées combinées à des impayés importants ou à un risque d’échec.',
];
const risques = (ctx) => memo(ctx, 'risques', async () => {
  const [E, N, Ab, S, P, Rt] = await Promise.all([elevesActifs(ctx), notes(ctx), absences(ctx), soldes(ctx), parents(ctx), retards(ctx)]);
  const out = [];
  for (const e of E) {
    const nt = N.eleves.get(e.id); const ab = Ab.get(e.id) || { nb: 0, jours: 0, nj: 0, jours_nj: 0 }; const so = S.get(e.id) || { du: 0, paye: 0, solde: 0, ratio: 0, jours_retard: null };
    const moy = nt ? nt.moyenne : null; const delta = nt ? nt.delta : null; const raisons = []; const types = new Set();
    let pe = 0; let pa = 0; let pi = 0; let pc = 0;
    if (moy !== null) {
      if (moy < 8) { pe += 45; raisons.push(`Moyenne très faible (${r1(moy)}/20)`); } else if (moy < SEUILS.moyenne_echec) { pe += 30; raisons.push(`Moyenne insuffisante (${r1(moy)}/20)`); } else if (moy < SEUILS.moyenne_alerte) { pe += 10; raisons.push(`Moyenne proche de la limite (${r1(moy)}/20)`); }
      const faibles = Object.entries(nt.matieres).filter(([, v]) => v < 8).map(([k]) => k);
      if (faibles.length >= 3) { pe += 10; raisons.push(`${faibles.length} matières sous 8/20 (${faibles.slice(0, 3).join(', ')})`); }
      if (delta !== null && delta <= -SEUILS.baisse_notable) { pe += 15; raisons.push(`Baisse de ${r1(-delta)} points entre les trimestres`); }
    }
    if (ab.nj >= 5) { pa += 25; raisons.push(`${ab.nj} absences non justifiées`); } else if (ab.nj >= SEUILS.absences_repetitives) { pa += 15; raisons.push(`${ab.nj} absences non justifiées`); }
    if (ab.jours >= 8) { pa += 10; raisons.push(`${r1(ab.jours)} jours d'absence au total`); }
    const rt = Rt.get(e.id) || { nb: 0, minutes: 0 };
    if (rt.nb >= 10) { pa += 10; raisons.push(`${rt.nb} retards d'arrivée`); } else if (rt.nb >= 5) { pa += 5; raisons.push(`${rt.nb} retards d'arrivée`); }
    if (so.solde > 0) {
      if (so.ratio >= 0.75) pi += 25; else if (so.ratio >= 0.5) pi += 15; else if (so.ratio >= 0.25) pi += 5;
      if (pi >= 15) raisons.push(`Reste à payer : ${so.solde.toFixed(2)} TND (${Math.round(so.ratio * 100)} %)`);
      if (so.jours_retard > 60) { pi += 5; raisons.push(`Échéance dépassée depuis ${so.jours_retard} jours`); }
    }
    const absRep = ab.nj >= SEUILS.absences_repetitives;
    const mauvais = (moy !== null && moy < SEUILS.moyenne_echec) || (delta !== null && delta <= -1.5);
    if (absRep && mauvais) { pc = 15; types.add('double'); }
    const score = Math.min(100, pe + pa + pi + pc);
    if (pe >= 30) types.add('echec');
    if (pi >= 15) types.add('impaye');
    if (pa >= 15 && (pi >= 15 || pe >= 30)) types.add('abandon');
    if (score < 20) continue;
    out.push({
      id: e.id, nom: `${e.prenom} ${e.nom}`, classe: e.classe, classe_id: e.classe_id, score,
      niveau: score >= 60 ? 'eleve' : score >= 35 ? 'moyen' : 'faible', types: [...types], raisons,
      moyenne: moy === null ? null : r1(moy), evolution: delta === null ? null : r1(delta), absences_nj: ab.nj, absences_jours: r1(ab.jours), retards: rt.nb,
      solde: so.solde, parents: (P.get(e.id) || []).slice(0, 2),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom));
});

// ---------- Prévision des effectifs de l'année suivante ----------
async function evolutionInscriptions(ctx) {
  const l = await rows("SELECT annee_entree annee, COUNT(*) nb FROM eleves WHERE deleted_at IS NULL AND annee_entree ~ '^[0-9]{4}-[0-9]{4}$' GROUP BY 1 ORDER BY 1");
  let cumul = 0; return l.filter((x) => x.annee <= ctx.annee).map((x) => { cumul += n(x.nb); return { annee: x.annee, nouveaux: n(x.nb), cumul }; });
}
// Taux de renouvellement : parmi les élèves entrés AVANT l'année en cours (hors diplômés), part de ceux qui sont toujours actifs.
async function renouvellement(ctx) {
  const r = (await rows(`SELECT COUNT(*) FILTER (WHERE statut='actif') actifs, COUNT(*) FILTER (WHERE statut='inactif') partis
     FROM eleves WHERE deleted_at IS NULL AND annee_entree ~ '^[0-9]{4}-[0-9]{4}$' AND annee_entree < $1`, [ctx.annee]))[0];
  const actifs = n(r.actifs); const partis = n(r.partis);
  return { reinscrits: actifs, departs: partis, taux: actifs + partis > 0 ? Math.round((actifs / (actifs + partis)) * 100) : null };
}
const previsionEffectifs = (ctx) => memo(ctx, 'prevision', async () => {
  const [E, evo, ren, pre] = await Promise.all([elevesActifs(ctx), evolutionInscriptions(ctx), renouvellement(ctx),
    rows("SELECT COUNT(*) nb FROM preinscriptions WHERE deleted_at IS NULL AND annee_scolaire=$1 AND statut IN ('en_attente','validee')", [ctx.suivante])]);
  const retention = (ren.taux !== null && ren.reinscrits + ren.departs >= 5 ? ren.taux : 95) / 100; // 95 % par défaut si l'historique est trop court
  const serie = evo.map((x) => x.nouveaux); const pv = prevoir(serie, 1);
  const preins = n(pre[0].nb); const nouveaux = Math.round(Math.max(pv.valeurs[0], preins));
  const niveaux = V.NIVEAUX; const actuel = Object.fromEntries(niveaux.map((nv) => [nv, 0]));
  for (const e of E) if (actuel[e.niveau] !== undefined) actuel[e.niveau]++;
  const nouveauxActuels = E.filter((e) => e.annee_entree === ctx.annee && actuel[e.niveau] !== undefined); // où entrent d'habitude les nouveaux
  const part = Object.fromEntries(niveaux.map((nv, i) => [nv, nouveauxActuels.length ? nouveauxActuels.filter((e) => e.niveau === nv).length / nouveauxActuels.length : (i === 0 ? 1 : 0)]));
  const parNiveau = niveaux.map((nv, i) => {
    const poursuivent = i === 0 ? 0 : Math.round(actuel[niveaux[i - 1]] * retention); // la 6ème année quitte l'école (fin de cycle)
    const arrivants = Math.round(nouveaux * part[nv]);
    return { niveau: nv, actuel: actuel[nv], poursuivent, nouveaux: arrivants, prevu: poursuivent + arrivants };
  });
  return {
    annee_suivante: ctx.suivante, effectif_actuel: E.length, effectif_prevu: parNiveau.reduce((s, x) => s + x.prevu, 0), taux_renouvellement: Math.round(retention * 100),
    renouvellement_estime: !(ren.taux !== null && ren.reinscrits + ren.departs >= 5), nouveaux_prevus: nouveaux, preinscriptions_recues: preins, par_niveau: parNiveau, fiable: pv.fiable && ren.taux !== null,
    methode: 'Effectif prévu = élèves de chaque niveau qui passent au niveau suivant (× taux de renouvellement observé ; la dernière année quitte l’école) + nouveaux inscrits prévus (tendance linéaire des inscriptions des années passées, au minimum les pré-inscriptions déjà reçues), répartis comme les nouveaux de cette année.',
  };
});

module.exports = {
  n, r1, r2, pct, moyenne, debut, anneeDe, rows, nomClasse, ordreNiveau, SEUILS, REGLES_RISQUE, moisAnnee, moisLabel, joursOuvres,
  regression, prevoir, correlation, contexte, memo, anneesDisponibles, elevesActifs, classesAnnee, notes, absences, retards, parents, soldes, risques,
  evolutionInscriptions, renouvellement, previsionEffectifs,
};

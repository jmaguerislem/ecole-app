// Tableaux de bord 1 à 5 : général, financier, pédagogique, absences, enseignants.
const V = require('../validate');
const B = require('./base');
const { n, r1, r2, pct, moyenne, rows, SEUILS } = B;

// ---------- 1. Général ----------
async function general(ctx) {
  const [classes, E, ens, par, evo, prev] = await Promise.all([
    B.classesAnnee(ctx), B.elevesActifs(ctx),
    rows("SELECT COUNT(*) nb FROM users WHERE role='enseignant' AND deleted_at IS NULL AND actif"),
    rows("SELECT COUNT(*) nb FROM users WHERE role='parent' AND deleted_at IS NULL AND actif"),
    B.evolutionInscriptions(ctx), B.previsionEffectifs(ctx),
  ]);
  const capacite = classes.reduce((t, c) => t + n(c.capacite), 0); const effectif = classes.reduce((t, c) => t + n(c.effectif), 0);
  const lignes = classes.map((c) => {
    const taux = c.capacite > 0 ? Math.round((c.effectif / c.capacite) * 100) : null;
    const statut = c.effectif > c.capacite * SEUILS.surcharge_classe ? 'surchargee' : c.effectif >= c.capacite * SEUILS.saturation_classe ? 'saturee' : c.effectif < c.capacite * SEUILS.sous_remplie_classe ? 'sous_remplie' : 'normale';
    return { id: c.id, nom: c.nom, niveau: c.niveau, effectif: n(c.effectif), capacite: n(c.capacite), taux, statut, places_libres: Math.max(0, c.capacite - c.effectif) };
  });
  const parNiveau = V.NIVEAUX.map((nv) => {
    const cs = lignes.filter((c) => c.niveau === nv); const cap = cs.reduce((t, c) => t + c.capacite, 0); const eff = cs.reduce((t, c) => t + c.effectif, 0);
    return { niveau: nv, classes: cs.length, effectif: eff, capacite: cap, taux: pct(eff, cap) };
  }).filter((x) => x.classes > 0 || x.effectif > 0);
  const alertes = [];
  for (const c of lignes) {
    if (c.statut === 'surchargee') alertes.push({ niveau: 'haute', type: 'surcharge', classe: c.nom, message: `${c.nom} est surchargée : ${c.effectif} élèves pour ${c.capacite} places.` });
    else if (c.statut === 'saturee') alertes.push({ niveau: 'moyenne', type: 'saturation', classe: c.nom, message: `${c.nom} est presque pleine (${c.effectif}/${c.capacite}).` });
    else if (c.statut === 'sous_remplie') alertes.push({ niveau: 'info', type: 'sous_remplie', classe: c.nom, message: `${c.nom} est sous-remplie (${c.effectif}/${c.capacite}).` });
  }
  const sansClasse = E.filter((e) => !e.classe_id).length;
  if (sansClasse) alertes.push({ niveau: 'moyenne', type: 'sans_classe', message: `${sansClasse} élève(s) actif(s) ne sont affectés à aucune classe.` });
  return {
    kpis: { eleves: E.length, enseignants: n(ens[0].nb), parents: n(par[0].nb), classes: classes.length, eleves_par_enseignant: n(ens[0].nb) ? r1(E.length / n(ens[0].nb)) : null,
      eleves_par_classe: classes.length ? r1(effectif / classes.length) : null, capacite_totale: capacite, effectif_en_classe: effectif, taux_occupation: pct(effectif, capacite), places_libres: Math.max(0, capacite - effectif), sans_classe: sansClasse },
    par_niveau: parNiveau, classes: lignes, evolution: evo, alertes, prevision: { annee: prev.annee_suivante, effectif_actuel: prev.effectif_actuel, effectif_prevu: prev.effectif_prevu, capacite_actuelle: capacite },
    note_evolution: "Le nombre d'inscrits par année est calculé d'après l'année d'entrée de chaque élève (l'application ne conserve pas l'effectif de chaque année passée).",
  };
}

// ---------- 2. Financier ----------
async function financier(ctx) {
  const [S, E] = await Promise.all([B.soldes(ctx), B.elevesActifs(ctx)]);
  const [pm, pmPrev, modes, tot, P] = await Promise.all([
    rows("SELECT to_char(date_paiement,'YYYY-MM') m, SUM(montant) s, COUNT(*) nb FROM paiements WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1", [ctx.annee]),
    rows("SELECT to_char(date_paiement,'YYYY-MM') m, SUM(montant) s FROM paiements WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1", [ctx.precedente]),
    rows('SELECT mode, SUM(montant) s, COUNT(*) nb FROM paiements WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1 ORDER BY 2 DESC', [ctx.annee]),
    rows('SELECT COALESCE(SUM(montant),0) s, COUNT(*) nb FROM paiements WHERE deleted_at IS NULL AND annee_scolaire=$1', [ctx.annee]),
    B.parents(ctx),
  ]);
  let attendu = 0; let encaisse = 0; let reste = 0; let couvert = 0;
  for (const e of E) { const s = S.get(e.id); if (!s) continue; attendu += s.du; encaisse += s.paye; reste += s.solde; couvert += Math.min(s.paye, s.du); }
  const taux = pct(couvert, attendu);
  const mois = B.moisAnnee(ctx.annee); const M = new Map(pm.map((x) => [x.m, n(x.s)])); const MP = new Map(pmPrev.map((x) => [x.m, n(x.s)]));
  let cumul = 0;
  const parMois = mois.map((m, i) => { cumul += M.get(m) || 0; return { mois: m, label: B.moisLabel(m), encaisse: r2(M.get(m) || 0), cumul: r2(cumul), annee_precedente: r2(MP.get(mois[i].replace(/^\d{4}/, (y) => String(Number(y) - 1))) || 0) }; });
  // Prévision : moyenne des 3 derniers mois COMPLETS, plafonnée par le reste à encaisser (année en cours uniquement)
  let prevision = []; let methode = null;
  const courant = ctx.aujourdhui.slice(0, 7);
  if (ctx.annee === require('../../config').anneeCourante) {
    const passes = mois.filter((m) => m < courant); const base = passes.slice(-3).map((m) => M.get(m) || 0);
    if (base.length) {
      const moy = moyenne(base); let rest = reste;
      for (const m of mois.filter((x) => x >= courant).slice(0, 3)) { const v = Math.min(moy, rest); rest -= v; prevision.push({ mois: m, label: B.moisLabel(m), prevu: r2(Math.max(0, v)) }); }
      methode = `Moyenne des ${base.length} derniers mois complets (${r2(moy)} TND/mois), limitée au reste à encaisser.`;
    }
  }
  const parNiveau = V.NIVEAUX.map((nv) => {
    const es = E.filter((e) => e.niveau === nv); const a = es.reduce((t, e) => t + (S.get(e.id)?.du || 0), 0); const c = es.reduce((t, e) => t + Math.min(S.get(e.id)?.paye || 0, S.get(e.id)?.du || 0), 0);
    return { niveau: nv, eleves: es.length, attendu: r2(a), encaisse: r2(c), taux: pct(c, a) };
  }).filter((x) => x.eleves > 0);
  const retards = E.map((e) => ({ e, s: S.get(e.id) })).filter((x) => x.s && x.s.solde > 0)
    .sort((a, b) => (b.s.jours_retard ?? -1) - (a.s.jours_retard ?? -1) || b.s.solde - a.s.solde).slice(0, 25)
    .map(({ e, s }) => ({ id: e.id, eleve: `${e.prenom} ${e.nom}`, classe: e.classe, du: s.du, paye: s.paye, solde: s.solde, jours_retard: s.jours_retard, parents: (P.get(e.id) || []).slice(0, 2) }));
  const nbDebiteurs = E.filter((e) => (S.get(e.id)?.solde || 0) > 0).length;
  return {
    kpis: { attendu: r2(attendu), encaisse: r2(encaisse), reste: r2(reste), taux_recouvrement: taux, eleves_actifs: E.length, eleves_avec_retard: nbDebiteurs, encaisse_total_annee: r2(n(tot[0].s)), nombre_paiements: n(tot[0].nb) },
    par_mois: parMois, par_mode: modes.map((m) => ({ mode: m.mode, total: r2(m.s), nombre: n(m.nb) })), par_niveau: parNiveau, retards, prevision, methode_prevision: methode,
    note: 'Montants dus = tarifs de l’année applicables au niveau de chaque élève actif ; reste = différence avec les paiements enregistrés.',
  };
}

// ---------- 3. Pédagogique ----------
async function pedagogique(ctx) {
  const [N, E, classes] = await Promise.all([B.notes(ctx), B.elevesActifs(ctx), B.classesAnnee(ctx)]);
  const actifs = new Map(E.map((e) => [e.id, e])); const cl = new Map(classes.map((c) => [c.id, c]));
  const eleves = [...N.eleves.values()].filter((x) => actifs.has(x.id) && x.moyenne !== null);
  const moy = eleves.map((x) => x.moyenne); const reussite = eleves.filter((x) => x.moyenne >= SEUILS.moyenne_echec).length;
  const parClasse = classes.map((c) => {
    const es = eleves.filter((x) => (actifs.get(x.id).classe_id === c.id)); const m = moyenne(es.map((x) => x.moyenne)); const ok = es.filter((x) => x.moyenne >= SEUILS.moyenne_echec).length;
    const tri = [1, 2, 3].map((t) => { const v = es.filter((x) => x.trimestres[t] !== undefined).map((x) => x.trimestres[t]); return v.length ? r1(moyenne(v)) : null; });
    return { id: c.id, nom: c.nom, niveau: c.niveau, eleves: es.length, moyenne: m === null ? null : r1(m), taux_reussite: pct(ok, es.length), taux_echec: es.length ? 100 - pct(ok, es.length) : null, trimestres: tri };
  }).filter((c) => c.eleves > 0);
  const parNiveau = V.NIVEAUX.map((nv) => {
    const es = eleves.filter((x) => actifs.get(x.id).niveau === nv); if (!es.length) return null;
    const ok = es.filter((x) => x.moyenne >= SEUILS.moyenne_echec).length;
    return { niveau: nv, eleves: es.length, moyenne: r1(moyenne(es.map((x) => x.moyenne))), taux_reussite: pct(ok, es.length) };
  }).filter(Boolean);
  const mats = {};
  for (const x of eleves) for (const [k, v] of Object.entries(x.matieres)) (mats[k] ||= []).push(v);
  const parMatiere = Object.entries(mats).map(([nom, v]) => ({ nom, eleves: v.length, moyenne: r1(moyenne(v)), taux_reussite: pct(v.filter((y) => y >= SEUILS.moyenne_echec).length, v.length) }))
    .sort((a, b) => b.moyenne - a.moyenne).map((m, i) => ({ ...m, rang: i + 1 }));
  const parTrimestre = [1, 2, 3].map((t) => {
    const v = eleves.filter((x) => x.trimestres[t] !== undefined).map((x) => x.trimestres[t]);
    return { trimestre: t, label: `Trimestre ${t}`, eleves: v.length, moyenne: v.length ? r1(moyenne(v)) : null, taux_reussite: v.length ? pct(v.filter((y) => y >= SEUILS.moyenne_echec).length, v.length) : null };
  }).filter((t) => t.eleves > 0);
  const faibles = (x) => Object.entries(x.matieres).sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, v]) => v < SEUILS.moyenne_echec).map(([k, v]) => `${k} (${r1(v)})`);
  const fiche = (x, raisons) => ({ id: x.id, nom: `${actifs.get(x.id).prenom} ${actifs.get(x.id).nom}`, classe: actifs.get(x.id).classe, moyenne: r1(x.moyenne), evolution: x.delta === null ? null : r1(x.delta), matieres_faibles: faibles(x), raisons });
  const difficulte = eleves.filter((x) => x.moyenne < SEUILS.moyenne_echec).sort((a, b) => a.moyenne - b.moyenne).slice(0, 20).map((x) => fiche(x, []));
  const accompagnement = [];
  for (const x of eleves) {
    const raisons = []; const nbFaibles = Object.values(x.matieres).filter((v) => v < 8).length;
    if (x.moyenne < SEUILS.moyenne_echec) raisons.push('Moyenne sous 10');
    if (x.delta !== null && x.delta <= -SEUILS.baisse_notable) raisons.push(`Baisse de ${r1(-x.delta)} points`);
    if (nbFaibles >= 3) raisons.push(`${nbFaibles} matières sous 8`);
    if (x.moyenne >= SEUILS.moyenne_echec && x.moyenne < SEUILS.moyenne_alerte && x.delta !== null && x.delta < 0) raisons.push('Moyenne limite et en baisse');
    if (raisons.length) accompagnement.push({ ...fiche(x, raisons), _p: raisons.length * 10 + (SEUILS.moyenne_echec - x.moyenne) });
  }
  accompagnement.sort((a, b) => b._p - a._p); accompagnement.forEach((a) => delete a._p);
  return {
    kpis: { eleves_notes: eleves.length, moyenne_generale: moy.length ? r1(moyenne(moy)) : null, taux_reussite: pct(reussite, eleves.length), taux_echec: eleves.length ? 100 - pct(reussite, eleves.length) : null, en_difficulte: eleves.filter((x) => x.moyenne < SEUILS.moyenne_echec).length, a_accompagner: accompagnement.length },
    par_classe: parClasse, par_niveau: parNiveau, par_matiere: parMatiere, par_trimestre: parTrimestre, en_difficulte: difficulte, a_accompagner: accompagnement.slice(0, 25),
    regles: ['Notes ramenées sur 20 ; moyenne d’un trimestre pondérée par les coefficients des matières ; moyenne annuelle = moyenne des trimestres.', 'Réussite = moyenne ≥ 10 ; échec = moyenne < 10.',
      'À accompagner : moyenne < 10, ou baisse ≥ 2 points entre trimestres, ou au moins 3 matières < 8, ou moyenne limite (10–11) en baisse.'],
  };
}

// ---------- 4. Absences et retards ----------
async function absencesTableau(ctx) {
  const [E, Ab, N, classes, mensuel, dev] = await Promise.all([B.elevesActifs(ctx), B.absences(ctx), B.notes(ctx), B.classesAnnee(ctx),
    B.rows(`SELECT to_char(date_absence,'YYYY-MM') m, SUM(CASE periode WHEN 'journee' THEN 1 ELSE 0.5 END) FILTER (WHERE justifiee) j, SUM(CASE periode WHEN 'journee' THEN 1 ELSE 0.5 END) FILTER (WHERE NOT justifiee) nj
       FROM absences WHERE deleted_at IS NULL AND annee_scolaire=$1 GROUP BY 1`, [ctx.annee]),
    B.rows(`SELECT COUNT(*) FILTER (WHERE d.en_retard) retard, COUNT(*) total FROM depots d JOIN devoirs dv ON dv.id=d.devoir_id WHERE dv.annee_scolaire=$1`, [ctx.annee])]);
  const bornes = V.bornesAnnee(ctx.annee); const fin = bornes.fin < ctx.aujourdhui ? bornes.fin : ctx.aujourdhui;
  const possibles = bornes.debut > fin ? 0 : B.joursOuvres(bornes.debut, fin);
  const actifs = new Map(E.map((e) => [e.id, e]));
  const lignes = [...Ab.entries()].filter(([id]) => actifs.has(id)).map(([id, a]) => ({ id, ...a, e: actifs.get(id) }));
  const tot = lignes.reduce((t, l) => ({ nb: t.nb + l.nb, jours: t.jours + l.jours, justifiees: t.justifiees + l.justifiees, nj: t.nj + l.nj }), { nb: 0, jours: 0, justifiees: 0, nj: 0 });
  const parClasse = classes.map((c) => {
    const ls = lignes.filter((l) => l.e.classe_id === c.id); const jours = ls.reduce((t, l) => t + l.jours, 0);
    return { id: c.id, nom: c.nom, effectif: n(c.effectif), jours: r1(jours), eleves_concernes: ls.length, taux: c.effectif && possibles ? r1((jours / (c.effectif * possibles)) * 100) : null };
  }).filter((c) => c.effectif > 0);
  const taux = E.length && possibles ? r1((tot.jours / (E.length * possibles)) * 100) : null;
  const parEleve = [...lignes].sort((a, b) => b.jours - a.jours).slice(0, 15).map((l) => ({ id: l.id, nom: `${l.e.prenom} ${l.e.nom}`, classe: l.e.classe, jours: r1(l.jours), justifiees: l.justifiees, non_justifiees: l.nj, taux: possibles ? r1((l.jours / possibles) * 100) : null }));
  const repetitives = lignes.filter((l) => l.nj >= SEUILS.absences_repetitives).sort((a, b) => b.nj - a.nj).map((l) => ({ id: l.id, nom: `${l.e.prenom} ${l.e.nom}`, classe: l.e.classe, non_justifiees: l.nj, jours: r1(l.jours), derniere: l.derniere }));
  const M = new Map(mensuel.map((x) => [x.m, x]));
  const parMois = B.moisAnnee(ctx.annee).map((m) => ({ mois: m, label: B.moisLabel(m), justifiees: r1(n(M.get(m)?.j)), non_justifiees: r1(n(M.get(m)?.nj)) }));
  // Lien absences ↔ résultats : tous les élèves actifs notés (ceux sans absence comptent pour 0)
  const notes = E.map((e) => ({ e, nt: N.eleves.get(e.id) })).filter((x) => x.nt && x.nt.moyenne !== null);
  const xs = notes.map((x) => Ab.get(x.e.id)?.jours || 0); const ys = notes.map((x) => x.nt.moyenne); const r = B.correlation(xs, ys);
  const tranches = [['0 jour', (j) => j === 0], ['0,5 à 2 jours', (j) => j > 0 && j <= 2], ['2,5 à 5 jours', (j) => j > 2 && j <= 5], ['Plus de 5 jours', (j) => j > 5]]
    .map(([label, f]) => { const v = notes.filter((x) => f(Ab.get(x.e.id)?.jours || 0)).map((x) => x.nt.moyenne); return { label, eleves: v.length, moyenne: v.length ? r1(moyenne(v)) : null }; });
  const lecture = r === null ? 'Pas assez de données (au moins 3 élèves notés).'
    : r <= -0.5 ? 'Lien fort : plus un élève est absent, plus sa moyenne est basse.' : r <= -0.25 ? 'Lien modéré : les élèves très absents ont tendance à avoir de moins bons résultats.' : r < 0.25 ? 'Pas de lien net entre absences et résultats dans cet établissement.' : 'Lien inhabituel (positif) : à vérifier, peu d’absences ou échantillon réduit.';
  return {
    kpis: { jours_absence: r1(tot.jours), nombre_absences: tot.nb, justifiees: tot.justifiees, non_justifiees: tot.nj, taux_absenteisme: taux, eleves_concernes: lignes.length, absences_repetitives: repetitives.length, jours_de_classe: possibles,
      devoirs_en_retard: n(dev[0].retard), depots_total: n(dev[0].total), taux_devoirs_en_retard: pct(n(dev[0].retard), n(dev[0].total)) },
    par_classe: parClasse, par_eleve: parEleve, repetitives, par_mois: parMois, relation: { correlation: r === null ? null : Math.round(r * 100) / 100, eleves: notes.length, tranches, lecture },
    non_suivi: ["Les retards d'arrivée en classe ne sont pas enregistrés (seules les absences le sont). Le retard de remise des devoirs est affiché à titre d'indicateur de substitution."],
    regles: ['Journée entière = 1 jour, demi-journée = 0,5 jour.', `Taux d'absentéisme = jours d'absence ÷ (élèves × jours de classe écoulés, lundi–samedi).`, `Absences répétitives : au moins ${SEUILS.absences_repetitives} absences non justifiées.`],
  };
}

// ---------- 5. Enseignants ----------
async function enseignants(ctx) {
  const [T, aff, cren] = await Promise.all([
    B.rows("SELECT id, nom, prenom, specialite FROM users WHERE role='enseignant' AND deleted_at IS NULL AND actif ORDER BY nom, prenom"),
    B.rows(`SELECT a.enseignant_id, m.nom matiere, c.niveau, c.id classe_id FROM affectations a JOIN matieres m ON m.id=a.matiere_id JOIN classes c ON c.id=a.classe_id
            WHERE a.deleted_at IS NULL AND a.annee_scolaire=$1`, [ctx.annee]),
    B.rows(`SELECT cr.enseignant_id, cr.jour, m.nom matiere, c.niveau, c.id classe_id, EXTRACT(EPOCH FROM (cr.heure_fin-cr.heure_debut))/3600 h
            FROM creneaux cr JOIN matieres m ON m.id=cr.matiere_id JOIN classes c ON c.id=cr.classe_id WHERE cr.deleted_at IS NULL AND cr.annee_scolaire=$1`, [ctx.annee])]);
  const fiches = T.map((t) => {
    const a = aff.filter((x) => x.enseignant_id === t.id); const c = cren.filter((x) => x.enseignant_id === t.id);
    const heures = c.reduce((s, x) => s + n(x.h), 0);
    return { id: t.id, nom: `${t.prenom} ${t.nom}`, specialite: t.specialite || null, matieres: [...new Set([...a.map((x) => x.matiere), ...c.map((x) => x.matiere)])], niveaux: [...new Set([...a.map((x) => x.niveau), ...c.map((x) => x.niveau)])],
      classes: new Set([...a.map((x) => x.classe_id), ...c.map((x) => x.classe_id)]).size, heures: r1(heures), jours: new Set(c.map((x) => x.jour)).size };
  });
  const charge = fiches.length ? moyenne(fiches.map((f) => f.heures)) : 0;
  for (const f of fiches) f.statut = charge > 0 && f.heures > charge * SEUILS.surcharge_enseignant ? 'surcharge' : (f.heures < charge * SEUILS.sous_charge_enseignant ? 'sous_charge' : 'equilibre');
  const compte = (cle) => { const m = new Map(); for (const x of aff.concat(cren)) { const k = x[cle]; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(x.enseignant_id); } return m; };
  const mat = compte('matiere'); const niv = compte('niveau');
  const heuresMat = {}; for (const x of cren) heuresMat[x.matiere] = (heuresMat[x.matiere] || 0) + n(x.h);
  const jours = [1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, label: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][j - 1], heures: r1(cren.filter((x) => x.jour === j).reduce((s, x) => s + n(x.h), 0)) }));
  return {
    kpis: { enseignants: fiches.length, heures_totales: r1(fiches.reduce((s, f) => s + f.heures, 0)), charge_moyenne: r1(charge), surcharge: fiches.filter((f) => f.statut === 'surcharge').length, sous_charge: fiches.filter((f) => f.statut === 'sous_charge').length, sans_emploi_du_temps: fiches.filter((f) => f.heures === 0).length },
    enseignants: fiches.sort((a, b) => b.heures - a.heures),
    par_matiere: [...mat.entries()].map(([nom, s]) => ({ nom, enseignants: s.size, heures: r1(heuresMat[nom] || 0) })).sort((a, b) => b.heures - a.heures || b.enseignants - a.enseignants),
    par_niveau: V.NIVEAUX.filter((nv) => niv.has(nv)).map((nv) => ({ niveau: nv, enseignants: niv.get(nv).size })), par_jour: jours,
    non_suivi: ["Les absences des enseignants et leurs remplacements ne sont pas enregistrés dans l'application : ces deux indicateurs ne peuvent pas être calculés."],
    regles: ['Charge horaire = somme des durées des créneaux de l’emploi du temps (heures par semaine).', `Surcharge : plus de ${Math.round(SEUILS.surcharge_enseignant * 100)} % de la charge moyenne ; sous-charge : moins de ${Math.round(SEUILS.sous_charge_enseignant * 100)} %.`],
  };
}

module.exports = { general, financier, pedagogique, absences: absencesTableau, enseignants };

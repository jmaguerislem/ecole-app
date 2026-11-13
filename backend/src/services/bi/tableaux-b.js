// Tableaux de bord 6 à 10 : inscriptions, communication, emplois du temps, risques, stratégique (+ simulation).
const V = require('../validate');
const { AUGMENTATION } = require('../tarifs');
const B = require('./base');
const A = require('./tableaux-a');
const { n, r1, r2, pct, moyenne, rows, SEUILS } = B;
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ---------- 6. Inscriptions et fidélisation ----------
async function inscriptions(ctx) {
  const [evo, ren, prev, pre, cohortes, orig, tot] = await Promise.all([
    B.evolutionInscriptions(ctx), B.renouvellement(ctx), B.previsionEffectifs(ctx),
    rows("SELECT annee_scolaire a, statut, COUNT(*) nb FROM preinscriptions WHERE deleted_at IS NULL AND annee_scolaire IN ($1,$2) GROUP BY 1,2", [ctx.annee, ctx.suivante]),
    rows(`SELECT annee_entree annee, COUNT(*) total, COUNT(*) FILTER (WHERE statut='actif') actifs, COUNT(*) FILTER (WHERE statut='inactif') partis, COUNT(*) FILTER (WHERE statut='diplome') diplomes
          FROM eleves WHERE deleted_at IS NULL AND annee_entree ~ '^[0-9]{4}-[0-9]{4}$' AND annee_entree <= $1 GROUP BY 1 ORDER BY 1`, [ctx.annee]),
    rows(`SELECT CASE WHEN adresse IS NULL OR trim(adresse)='' THEN 'Non renseignée'
                 ELSE initcap(trim(regexp_replace(regexp_replace(trim(adresse), '^.*,[[:space:]]*', ''), '^[0-9]+[[:space:]]*', ''))) END zone, COUNT(*) nb
          FROM eleves WHERE deleted_at IS NULL AND statut='actif' GROUP BY 1 ORDER BY 2 DESC`),
    rows("SELECT COUNT(*) FILTER (WHERE annee_entree=$1) nouveaux, COUNT(*) FILTER (WHERE statut='inactif') inactifs, COUNT(*) FILTER (WHERE statut='diplome') diplomes FROM eleves WHERE deleted_at IS NULL", [ctx.annee]),
  ]);
  const statut = (a) => Object.fromEntries(pre.filter((x) => x.a === a).map((x) => [x.statut, n(x.nb)]));
  const pc = statut(ctx.annee); const ps = statut(ctx.suivante);
  const totalPre = Object.values(pc).reduce((s, v) => s + v, 0);
  const sansNR = orig.filter((o) => o.zone !== 'Non renseignée'); const top = sansNR.slice(0, 8); const autres = sansNR.slice(8).reduce((s, o) => s + n(o.nb), 0);
  const origine = [...top.map((o) => ({ label: o.zone, value: n(o.nb) })), ...(autres ? [{ label: 'Autres', value: autres }] : []), ...orig.filter((o) => o.zone === 'Non renseignée').map((o) => ({ label: o.zone, value: n(o.nb) }))];
  return {
    kpis: { nouveaux: n(tot[0].nouveaux), reinscrits: ren.reinscrits, taux_renouvellement: ren.taux, departs: n(tot[0].inactifs), diplomes: n(tot[0].diplomes), preinscriptions: totalPre, preinscriptions_validees: n(pc.validee), preinscriptions_en_attente: n(pc.en_attente),
      taux_conversion_preinscriptions: pct(n(pc.validee), totalPre), effectif_prevu: prev.effectif_prevu },
    evolution: evo, cohortes: cohortes.map((c) => ({ annee: c.annee, total: n(c.total), actifs: n(c.actifs), departs: n(c.partis), diplomes: n(c.diplomes), taux_maintien: pct(n(c.actifs) + n(c.diplomes), n(c.total)) })),
    origine, prevision: prev, preinscriptions_suivante: { annee: ctx.suivante, en_attente: n(ps.en_attente), validees: n(ps.validee), refusees: n(ps.refusee) },
    non_suivi: ["La date de départ d'un élève n'est pas enregistrée : les départs sont les élèves actuellement « inactifs », rattachés à leur année d'entrée."],
    regles: ['Réinscrits = élèves entrés avant cette année et toujours actifs.', 'Taux de renouvellement = réinscrits ÷ (réinscrits + départs), hors diplômés.', "Origine géographique = dernier élément de l'adresse (ville ou quartier)."],
  };
}

// ---------- 7. Communication avec les parents ----------
async function communication(ctx) {
  const bornes = V.bornesAnnee(ctx.annee); const d1 = bornes.debut; const d2 = `${bornes.fin}T23:59:59`;
  const [tot, mensuel, parParent, notif, demandes, nbParents, R] = await Promise.all([
    rows(`SELECT COUNT(DISTINCT m.id) messages, COUNT(*) destinataires, COUNT(mr.read_at) lus FROM messages m JOIN message_recipients mr ON mr.message_id=m.id JOIN users u ON u.id=mr.user_id AND u.role='parent'
          WHERE m.statut='envoye' AND m.sent_at >= $1 AND m.sent_at <= $2 AND m.sender_id <> mr.user_id`, [d1, d2]),
    rows(`SELECT to_char(m.sent_at,'YYYY-MM') mois, COUNT(DISTINCT m.id) messages, COUNT(*) destinataires, COUNT(mr.read_at) lus FROM messages m JOIN message_recipients mr ON mr.message_id=m.id JOIN users u ON u.id=mr.user_id AND u.role='parent'
          WHERE m.statut='envoye' AND m.sent_at >= $1 AND m.sent_at <= $2 AND m.sender_id <> mr.user_id GROUP BY 1`, [d1, d2]),
    rows(`SELECT u.id, u.nom, u.prenom, u.telephone, COUNT(*) recus, COUNT(mr.read_at) lus, MAX(m.sent_at) dernier FROM messages m JOIN message_recipients mr ON mr.message_id=m.id JOIN users u ON u.id=mr.user_id AND u.role='parent' AND u.deleted_at IS NULL AND u.actif
          WHERE m.statut='envoye' AND m.sent_at >= $1 AND m.sent_at <= $2 AND m.sender_id <> mr.user_id GROUP BY u.id, u.nom, u.prenom, u.telephone`, [d1, d2]),
    rows("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE nt.lu) lues FROM notifications nt JOIN users u ON u.id=nt.user_id AND u.role='parent' WHERE nt.created_at >= $1 AND nt.created_at <= $2", [d1, d2]),
    rows(`SELECT m.id, m.objet, m.sent_at, u.nom, u.prenom,
            (SELECT MIN(r.sent_at) FROM messages r JOIN users ru ON ru.id=r.sender_id WHERE r.thread_id=m.id AND r.statut='envoye' AND ru.role<>'parent') reponse
          FROM messages m JOIN users u ON u.id=m.sender_id AND u.role='parent' WHERE m.statut='envoye' AND m.thread_id IS NULL AND m.sent_at >= $1 AND m.sent_at <= $2 ORDER BY m.sent_at DESC`, [d1, d2]),
    rows("SELECT COUNT(*) nb FROM users WHERE role='parent' AND deleted_at IS NULL AND actif"),
    B.risques(ctx),
  ]);
  const P = parParent.map((p) => ({ id: p.id, nom: `${p.prenom} ${p.nom}`, telephone: p.telephone, recus: n(p.recus), lus: n(p.lus), taux: pct(n(p.lus), n(p.recus)), dernier: p.dernier }));
  const jamais = P.filter((p) => p.recus >= 1 && p.lus === 0).sort((a, b) => b.recus - a.recus);
  const faibles = P.filter((p) => p.recus >= 3 && p.lus > 0 && p.taux < SEUILS.lecture_faible).sort((a, b) => a.taux - b.taux);
  const now = new Date(); const attente = []; let repondues = 0; const delais = [];
  for (const d of demandes) {
    if (d.reponse) { repondues++; delais.push((new Date(d.reponse) - new Date(d.sent_at)) / 3600000); } else {
      const jours = Math.floor((now - new Date(d.sent_at)) / 86400000);
      attente.push({ id: d.id, objet: d.objet, parent: `${d.prenom} ${d.nom}`, date: d.sent_at, jours, en_retard: jours > SEUILS.reponse_parent_jours });
    }
  }
  const M = new Map(mensuel.map((x) => [x.mois, x]));
  const parMois = B.moisAnnee(ctx.annee).map((m) => ({ mois: m, label: B.moisLabel(m), messages: n(M.get(m)?.messages), destinataires: n(M.get(m)?.destinataires), lus: n(M.get(m)?.lus), taux_lecture: pct(n(M.get(m)?.lus), n(M.get(m)?.destinataires)) }));
  const lectureP = new Map(P.map((p) => [p.id, p]));
  const renfort = R.filter((r) => r.niveau !== 'faible').flatMap((r) => r.parents.map((par) => ({ r, par, st: lectureP.get(par.id) })))
    .filter((x) => !x.st || x.st.recus === 0 || x.st.lus === 0 || x.st.taux < SEUILS.lecture_faible)
    .map(({ r, par, st }) => ({ parent: par.nom, telephone: par.telephone, eleve: r.nom, classe: r.classe, score: r.score, niveau: r.niveau, raison: r.raisons[0] || '', messages_recus: st ? st.recus : 0, messages_lus: st ? st.lus : 0,
      constat: !st || st.recus === 0 ? 'Aucun message reçu : contact à initier' : st.lus === 0 ? 'Aucun message lu' : `${st.taux} % des messages lus` })).slice(0, 25);
  return {
    kpis: { messages_envoyes: n(tot[0].messages), destinataires: n(tot[0].destinataires), taux_lecture: pct(n(tot[0].lus), n(tot[0].destinataires)), parents: n(nbParents[0].nb), parents_sans_lecture: jamais.length, parents_lecture_faible: faibles.length,
      taux_lecture_notifications: pct(n(notif[0].lues), n(notif[0].total)), notifications: n(notif[0].total), demandes_parents: demandes.length, demandes_sans_reponse: attente.length, demandes_en_retard: attente.filter((a) => a.en_retard).length,
      delai_reponse_heures: delais.length ? r1(moyenne(delais)) : null, parents_a_renforcer: renfort.length },
    par_mois: parMois, parents_sans_lecture: jamais.slice(0, 20), parents_lecture_faible: faibles.slice(0, 20), demandes_en_attente: attente.slice(0, 20), suivi_renforce: renfort,
    regles: [`Parent « ne consulte pas » : au moins 1 message reçu et aucun lu ; lecture faible : au moins 3 messages et moins de ${SEUILS.lecture_faible} % lus.`, `Demande sans réponse : message d'un parent resté sans réponse du personnel ; en retard au-delà de ${SEUILS.reponse_parent_jours} jours.`,
      'Suivi parental à renforcer : parent d’un élève à risque moyen ou élevé (tableau « Détection des risques ») qui lit peu ou pas les messages.'],
    non_suivi: ["Il n'existe pas de module de « réclamations » : les demandes des parents sont les messages qu'ils envoient à l'école."],
  };
}

// ---------- 8. Emplois du temps et ressources ----------
const chevauche = (a, b) => a.d < b.f && b.d < a.f;
async function edt(ctx) {
  const [salles, cren, ens, cls] = await Promise.all([
    rows('SELECT id, nom, capacite, disponible FROM salles WHERE deleted_at IS NULL ORDER BY nom'),
    rows(`SELECT id, classe_id, matiere_id, enseignant_id, salle_id, jour, EXTRACT(EPOCH FROM heure_debut)/3600 d, EXTRACT(EPOCH FROM heure_fin)/3600 f FROM creneaux WHERE deleted_at IS NULL AND annee_scolaire=$1`, [ctx.annee]),
    rows("SELECT id, nom, prenom FROM users WHERE role='enseignant' AND deleted_at IS NULL"), B.classesAnnee(ctx),
  ]);
  const cn = new Map(cls.map((c) => [c.id, c.nom])); const en = new Map(ens.map((e) => [e.id, `${e.prenom} ${e.nom}`])); const sn = new Map(salles.map((s) => [s.id, s.nom]));
  const C = cren.map((c) => ({ ...c, d: n(c.d), f: n(c.f), h: n(c.f) - n(c.d) }));
  const parJour = new Map(); for (const c of C) (parJour.get(c.jour) || parJour.set(c.jour, []).get(c.jour)).push(c);
  const amplitude = [...parJour.values()].reduce((s, l) => s + (Math.max(...l.map((c) => c.f)) - Math.min(...l.map((c) => c.d))), 0); // heures d'ouverture par semaine (déduites de l'emploi du temps)
  const occ = salles.map((s) => { const h = C.filter((c) => c.salle_id === s.id).reduce((t, c) => t + c.h, 0); const taux = amplitude ? Math.min(100, Math.round((h / amplitude) * 100)) : null;
    return { id: s.id, nom: s.nom, capacite: s.capacite, disponible: s.disponible, heures: r1(h), taux, statut: !s.disponible ? 'indisponible' : taux === null ? 'inconnu' : taux < SEUILS.salle_sous_utilisee ? 'sous_utilisee' : taux > SEUILS.salle_saturee ? 'saturee' : 'normale' }; });
  const conflits = [];
  for (const [jour, l] of parJour) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const a = l[i]; const b = l[j]; if (!chevauche(a, b)) continue;
    const quoi = []; if (a.enseignant_id === b.enseignant_id) quoi.push(['enseignant', en.get(a.enseignant_id)]); if (a.classe_id === b.classe_id) quoi.push(['classe', cn.get(a.classe_id)]); if (a.salle_id && a.salle_id === b.salle_id) quoi.push(['salle', sn.get(a.salle_id)]);
    for (const [type, nom] of quoi) conflits.push({ type, jour: JOURS[jour - 1], ressource: nom || '?', detail: `${nom || '?'} est affecté(e) à deux créneaux qui se chevauchent le ${JOURS[jour - 1].toLowerCase()}.` });
  }
  const hEns = new Map(); for (const c of C) hEns.set(c.enseignant_id, (hEns.get(c.enseignant_id) || 0) + c.h);
  const parEns = [...hEns.entries()].map(([id, h]) => ({ nom: en.get(id) || `Enseignant ${id}`, heures: r1(h) })).sort((a, b) => b.heures - a.heures);
  const equilibre = cls.map((c) => {
    const j = [1, 2, 3, 4, 5, 6].map((d) => r1(C.filter((x) => x.classe_id === c.id && x.jour === d).reduce((t, x) => t + x.h, 0))); const act = j.filter((h) => h > 0);
    const ecart = act.length ? Math.max(...act) - Math.min(...act) : 0; const total = act.reduce((t, h) => t + h, 0);
    return { id: c.id, nom: c.nom, par_jour: j, total: r1(total), ecart: r1(ecart), statut: !act.length ? 'sans_emploi_du_temps' : ecart >= 3 ? 'desequilibre' : 'equilibre' };
  });
  const sansSalle = C.filter((c) => !c.salle_id);
  return {
    kpis: { creneaux: C.length, heures_hebdo: r1(C.reduce((t, c) => t + c.h, 0)), amplitude_hebdo: r1(amplitude), salles: salles.length, salles_disponibles: salles.filter((s) => s.disponible).length,
      occupation_moyenne: occ.filter((o) => o.taux !== null && o.disponible).length ? Math.round(moyenne(occ.filter((o) => o.taux !== null && o.disponible).map((o) => o.taux))) : null,
      salles_sous_utilisees: occ.filter((o) => o.statut === 'sous_utilisee').length, salles_saturees: occ.filter((o) => o.statut === 'saturee').length, conflits: conflits.length, creneaux_sans_salle: sansSalle.length,
      classes_desequilibrees: equilibre.filter((e) => e.statut === 'desequilibre').length, classes_sans_emploi_du_temps: equilibre.filter((e) => e.statut === 'sans_emploi_du_temps').length },
    salles: occ.sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1)), conflits: conflits.slice(0, 30), heures_par_enseignant: parEns,
    par_jour: JOURS.map((label, i) => ({ jour: i + 1, label, heures: r1(C.filter((c) => c.jour === i + 1).reduce((t, c) => t + c.h, 0)) })), equilibre,
    regles: ['Heures d’ouverture = écart entre le premier début et la dernière fin de chaque jour, additionné sur la semaine.', `Taux d'occupation d'une salle = heures d'occupation ÷ heures d'ouverture ; sous-utilisée sous ${SEUILS.salle_sous_utilisee} %, saturée au-dessus de ${SEUILS.salle_saturee} %.`,
      'Conflit = deux créneaux qui se chevauchent pour le même enseignant, la même classe ou la même salle.', 'Emploi du temps déséquilibré : écart de 3 heures ou plus entre le jour le plus chargé et le moins chargé d’une classe.'],
  };
}

// ---------- 9. Détection des risques ----------
const ACTIONS = { double: 'Convoquer la famille et mettre en place un suivi pédagogique renforcé.', abandon: 'Contacter la famille cette semaine pour comprendre la situation.', echec: 'Proposer un soutien pédagogique ciblé sur les matières faibles.', impaye: 'Relancer la famille et proposer un échéancier de paiement.' };
async function risques(ctx) {
  const L = await B.risques(ctx); const cls = await B.classesAnnee(ctx);
  const compte = (t) => L.filter((x) => x.types.includes(t)).length;
  const parClasse = cls.map((c) => ({ nom: c.nom, effectif: n(c.effectif), a_risque: L.filter((x) => x.classe_id === c.id).length, eleves: L.filter((x) => x.classe_id === c.id && x.niveau !== 'faible').length }))
    .map((c) => ({ ...c, part: pct(c.a_risque, c.effectif) })).filter((c) => c.effectif > 0);
  const priorite = ['double', 'abandon', 'echec', 'impaye'];
  const alertes = L.filter((x) => x.niveau !== 'faible').slice(0, 12).map((x) => {
    const t = priorite.find((p) => x.types.includes(p)); return { niveau: x.niveau, eleve: x.nom, classe: x.classe, score: x.score, message: x.raisons.slice(0, 3).join(' ; '), action: ACTIONS[t] || 'Suivre la situation.' };
  });
  return {
    kpis: { eleves_a_risque: L.length, risque_eleve: L.filter((x) => x.niveau === 'eleve').length, risque_moyen: L.filter((x) => x.niveau === 'moyen').length, risque_faible: L.filter((x) => x.niveau === 'faible').length, echec: compte('echec'), abandon: compte('abandon'), impaye: compte('impaye'), double_risque: compte('double') },
    eleves: L.slice(0, 60), par_classe: parClasse, alertes, regles: B.REGLES_RISQUE,
    non_suivi: ["Ces indicateurs aident à repérer des situations : ils ne remplacent pas le jugement de l'équipe pédagogique. Aucune donnée n'est modifiée ni envoyée automatiquement."],
  };
}

// ---------- 10. Stratégique : prévisions, scénarios, besoins, recommandations ----------
const strat = (ctx) => B.memo(ctx, 'strat', async () => {
  const [prev, cls, E, tarifs, edtD, ensD, fin] = await Promise.all([
    B.previsionEffectifs(ctx), B.classesAnnee(ctx), B.elevesActifs(ctx), rows("SELECT type, niveau, montant FROM tarifs WHERE deleted_at IS NULL AND annee_scolaire=$1", [ctx.annee]),
    B.memo(ctx, 'edt', () => edt(ctx)), B.memo(ctx, 'ens', () => A.enseignants(ctx)), B.memo(ctx, 'fin', () => A.financier(ctx)),
  ]);
  const capRef = cls.length ? Math.round(moyenne(cls.map((c) => n(c.capacite)))) : 25;
  const hpc = edtD.equilibre.filter((e) => e.statut !== 'sans_emploi_du_temps'); // heures hebdomadaires moyennes d'une classe = moyenne des classes qui ont un emploi du temps
  const heuresParClasse = hpc.length ? r1(moyenne(hpc.map((e) => e.total))) : null;
  // Tarif de l'année suivante : montants actuels, + augmentation automatique pour la scolarité (mêmes règles que le module Tarifs)
  const tarifNiveau = (nv) => tarifs.filter((t) => !t.niveau || t.niveau === '' || t.niveau === nv).reduce((s, t) => s + n(t.montant) + (t.type === 'scolarite' && t.niveau ? AUGMENTATION : 0), 0);
  const fraisInscription = (() => { const l = tarifs.filter((t) => t.type === 'inscription'); return l.length ? moyenne(l.map((t) => n(t.montant))) : 0; })();
  const tarifsSuivants = Object.fromEntries(V.NIVEAUX.map((nv) => [nv, r2(tarifNiveau(nv))]));
  const charge = ensD.kpis.charge_moyenne > 0 ? ensD.kpis.charge_moyenne : null;
  return {
    prev, capRef, heuresParClasse, amplitude: edtD.kpis.amplitude_hebdo || null, sallesDispo: edtD.kpis.salles_disponibles, tarifsSuivants, fraisInscription: r2(fraisInscription),
    classesActuelles: cls.length, enseignantsActuels: ensD.kpis.enseignants, chargeMoyenne: charge, tauxRecouvrement: fin.kpis.taux_recouvrement, eleves: E.length,
  };
});
const HYP = { variation: 0, frais: 0, recouvrement: null, cout_enseignant: 1000, charges_par_eleve: 150, charge_cible: null };
const borne = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
function simuler(S, p = {}) {
  const prm = {
    variation: borne(p.variation, -50, 100, 0), frais: borne(p.frais, -50, 100, 0), recouvrement: borne(p.recouvrement, 0, 100, S.tauxRecouvrement ?? 90),
    cout_enseignant: borne(p.cout_enseignant, 0, 100000, HYP.cout_enseignant), charges_par_eleve: borne(p.charges_par_eleve, 0, 100000, HYP.charges_par_eleve), charge_cible: borne(p.charge_cible, 1, 60, S.chargeMoyenne ?? 20),
  };
  const f = 1 + prm.variation / 100; const niv = S.prev.par_niveau.map((x) => ({ niveau: x.niveau, effectif: Math.round(x.prevu * f) }));
  const effectif = niv.reduce((s, x) => s + x.effectif, 0);
  const classesNiv = niv.map((x) => ({ ...x, classes: x.effectif > 0 ? Math.ceil(x.effectif / S.capRef) : 0 })); const classes = classesNiv.reduce((s, x) => s + x.classes, 0);
  const heures = S.heuresParClasse ? classes * S.heuresParClasse : null;
  const enseignants = heures ? Math.ceil(heures / prm.charge_cible) : null;
  const salles = heures && S.amplitude ? Math.ceil(heures / (S.amplitude * 0.8)) : classes; // une salle est occupée à 80 % au plus
  const recScol = niv.reduce((s, x) => s + x.effectif * S.tarifsSuivants[x.niveau] * (1 + prm.frais / 100), 0) * (prm.recouvrement / 100);
  const recInsc = S.prev.nouveaux_prevus * f * S.fraisInscription * (prm.recouvrement / 100); const recettes = recScol + recInsc;
  const depenses = (enseignants || 0) * prm.cout_enseignant * 12 + effectif * prm.charges_par_eleve;
  return {
    parametres: prm, effectif, classes, classes_actuelles: S.classesActuelles, classes_a_ouvrir: Math.max(0, classes - S.classesActuelles), par_niveau: classesNiv, heures_hebdo: heures === null ? null : r1(heures),
    enseignants, enseignants_actuels: S.enseignantsActuels, enseignants_a_recruter: enseignants === null ? null : Math.max(0, enseignants - S.enseignantsActuels), salles, salles_disponibles: S.sallesDispo, salles_manquantes: Math.max(0, salles - S.sallesDispo),
    recettes: r2(recettes), depenses: r2(depenses), resultat: r2(recettes - depenses), marge: recettes > 0 ? Math.round(((recettes - depenses) / recettes) * 100) : null,
  };
}
async function comparaison(ctx) {
  const annees = (await B.anneesDisponibles(ctx)).filter((a) => a <= ctx.annee).slice(0, 4).reverse(); const evo = await B.evolutionInscriptions(ctx);
  const pay = await rows('SELECT annee_scolaire a, SUM(montant) s FROM paiements WHERE deleted_at IS NULL GROUP BY 1'); const P = new Map(pay.map((x) => [x.a, n(x.s)]));
  const out = [];
  for (const a of annees) {
    const [N, Ab] = await Promise.all([B.notes(ctx, a), B.absences(ctx, a)]); const m = [...N.eleves.values()].filter((x) => x.moyenne !== null).map((x) => x.moyenne);
    out.push({ annee: a, nouveaux: evo.find((x) => x.annee === a)?.nouveaux ?? 0, moyenne: m.length ? r1(moyenne(m)) : null, taux_reussite: m.length ? pct(m.filter((x) => x >= SEUILS.moyenne_echec).length, m.length) : null,
      jours_absence: r1([...Ab.values()].reduce((s, x) => s + x.jours, 0)), encaisse: r2(P.get(a) || 0), eleves_notes: m.length });
  }
  return out;
}
async function recommandations(ctx) {
  const [g, f, p, a, e, t, r, c, S] = await Promise.all([B.memo(ctx, 'g', () => A.general(ctx)), B.memo(ctx, 'fin', () => A.financier(ctx)), B.memo(ctx, 'ped', () => A.pedagogique(ctx)), B.memo(ctx, 'abs', () => A.absences(ctx)),
    B.memo(ctx, 'ens', () => A.enseignants(ctx)), B.memo(ctx, 'edt', () => edt(ctx)), risques(ctx), communication(ctx), strat(ctx)]);
  const R = []; const add = (priorite, domaine, titre, detail, action) => R.push({ priorite, domaine, titre, detail, action });
  for (const x of g.classes.filter((c) => c.statut === 'surchargee')) add('haute', 'Effectifs', `${x.nom} est surchargée`, `${x.effectif} élèves pour ${x.capacite} places.`, 'Rééquilibrer avec une classe voisine ou ouvrir une section supplémentaire.');
  const sous = g.classes.filter((c) => c.statut === 'sous_remplie'); if (sous.length) add('info', 'Effectifs', `${sous.length} classe(s) sous-remplie(s)`, sous.map((x) => `${x.nom} (${x.effectif}/${x.capacite})`).join(', '), 'Étudier un regroupement ou renforcer la communication pour les inscriptions.');
  if (f.kpis.taux_recouvrement !== null && f.kpis.taux_recouvrement < SEUILS.recouvrement_faible) add('haute', 'Finances', `Recouvrement faible : ${f.kpis.taux_recouvrement} %`, `${f.kpis.eleves_avec_retard} élève(s) ont un reste à payer, soit ${f.kpis.reste.toFixed(2)} TND.`, 'Lancer une campagne de relance et proposer des échéanciers.');
  else if (f.kpis.reste > 0 && f.retards.some((x) => x.jours_retard > 30)) add('moyenne', 'Finances', 'Des échéances sont dépassées de plus de 30 jours', `${f.retards.filter((x) => x.jours_retard > 30).length} famille(s) concernée(s).`, 'Envoyer un rappel aux parents concernés.');
  if (p.kpis.taux_echec !== null && p.kpis.taux_echec > SEUILS.echec_eleve) add('haute', 'Pédagogie', `Taux d'échec élevé : ${p.kpis.taux_echec} %`, `${p.kpis.en_difficulte} élève(s) ont une moyenne inférieure à 10.`, 'Organiser des séances de soutien et un suivi par les enseignants titulaires.');
  const faible = p.par_matiere[p.par_matiere.length - 1]; if (faible && faible.moyenne < SEUILS.moyenne_echec) add('moyenne', 'Pédagogie', `Matière la plus fragile : ${faible.nom}`, `Moyenne de ${faible.moyenne}/20, réussite ${faible.taux_reussite} %.`, 'Revoir la progression et prévoir un renforcement dans cette matière.');
  if (a.kpis.taux_absenteisme !== null && a.kpis.taux_absenteisme > SEUILS.absenteisme_eleve) add('haute', 'Absences', `Absentéisme élevé : ${a.kpis.taux_absenteisme} %`, `${a.kpis.non_justifiees} absence(s) non justifiée(s).`, 'Rappeler le règlement aux familles et contacter les élèves les plus absents.');
  if (a.kpis.absences_repetitives) add('moyenne', 'Absences', `${a.kpis.absences_repetitives} élève(s) avec des absences répétitives`, 'Au moins 3 absences non justifiées dans l’année.', 'Convoquer les familles concernées.');
  if (r.kpis.risque_eleve) add('haute', 'Risques', `${r.kpis.risque_eleve} élève(s) à risque élevé`, `Dont ${r.kpis.double_risque} cumulant absences répétées et baisse des résultats.`, 'Organiser une réunion de suivi cette semaine (voir « Détection des risques »).');
  if (e.kpis.surcharge) add('moyenne', 'Enseignants', `${e.kpis.surcharge} enseignant(s) en surcharge`, `Charge moyenne : ${e.kpis.charge_moyenne} h/semaine.`, 'Redistribuer des heures vers les enseignants en sous-charge.');
  if (e.kpis.sous_charge) add('info', 'Enseignants', `${e.kpis.sous_charge} enseignant(s) en sous-charge`, 'Moins de 60 % de la charge moyenne.', 'Leur confier des heures de soutien ou de remplacement.');
  if (t.kpis.conflits) add('haute', 'Emplois du temps', `${t.kpis.conflits} conflit(s) d'horaire`, 'Deux créneaux se chevauchent pour la même ressource.', 'Corriger les créneaux concernés dans « Emploi du temps ».');
  if (t.kpis.salles_sous_utilisees) add('info', 'Ressources', `${t.kpis.salles_sous_utilisees} salle(s) sous-utilisée(s)`, 'Occupation inférieure à 30 %.', 'Y affecter des activités ou en libérer l’usage.');
  if (c.kpis.taux_lecture !== null && c.kpis.taux_lecture < SEUILS.lecture_faible) add('moyenne', 'Communication', `Messages peu lus : ${c.kpis.taux_lecture} %`, `${c.kpis.parents_sans_lecture} parent(s) n'ont lu aucun message.`, 'Compléter par un appel ou un SMS pour les familles importantes.');
  if (c.kpis.demandes_en_retard) add('moyenne', 'Communication', `${c.kpis.demandes_en_retard} demande(s) de parents sans réponse depuis plus de ${SEUILS.reponse_parent_jours} jours`, '', 'Répondre rapidement aux familles.');
  if (c.kpis.parents_a_renforcer) add('moyenne', 'Suivi parental', `${c.kpis.parents_a_renforcer} parent(s) d'élèves à risque lisent peu l'école`, '', 'Les joindre par téléphone (liste dans « Communication »).');
  const capTot = g.kpis.capacite_totale; const besoin = simuler(S, {});
  if (capTot && S.prev.effectif_prevu > capTot) add('haute', 'Prévisions', `Effectif prévu (${S.prev.effectif_prevu}) supérieur à la capacité actuelle (${capTot})`, `Il faudrait ${besoin.classes} classes contre ${S.classesActuelles} aujourd'hui.`, 'Prévoir des salles et des enseignants supplémentaires.');
  else if (capTot && S.prev.effectif_prevu < capTot * 0.7) add('info', 'Prévisions', `Effectif prévu (${S.prev.effectif_prevu}) très inférieur à la capacité (${capTot} places)`, 'Moins de 70 % des places seraient occupées.', 'Renforcer les inscriptions (communication, portes ouvertes) ou regrouper des classes.');
  if (besoin.enseignants_a_recruter) add('moyenne', 'Prévisions', `${besoin.enseignants_a_recruter} enseignant(s) à recruter`, `Besoin estimé : ${besoin.enseignants} enseignants pour ${S.prev.annee_suivante}.`, 'Anticiper le recrutement.');
  const ordre = { haute: 0, moyenne: 1, info: 2 }; R.sort((x, y) => ordre[x.priorite] - ordre[y.priorite]);
  return R;
}
async function strategique(ctx) {
  const [S, comp, reco] = await Promise.all([strat(ctx), comparaison(ctx), recommandations(ctx)]);
  const base = simuler(S, {});
  const scenarios = [['Pessimiste', { variation: -10, recouvrement: Math.max(0, (S.tauxRecouvrement ?? 90) - 5) }], ['Prévision de base', {}], ['Optimiste', { variation: 10, recouvrement: Math.min(100, (S.tauxRecouvrement ?? 90) + 3) }]]
    .map(([nom, p]) => ({ nom, ...simuler(S, p) }));
  return {
    prevision: { ...S.prev, capacite_actuelle: S.classesActuelles * S.capRef }, besoins: base, scenarios, hypotheses: { ...HYP, recouvrement: S.tauxRecouvrement ?? 90, charge_cible: S.chargeMoyenne ?? 20 }, comparaison: comp, recommandations: reco,
    non_suivi: ["Les dépenses ne sont pas enregistrées dans l'application : elles sont ESTIMÉES à partir d'hypothèses (coût mensuel d'un enseignant, charges par élève) que vous pouvez modifier. Les recettes viennent des tarifs et du taux de recouvrement observé."],
    regles: [S.prev.methode, 'Classes nécessaires = effectif prévu de chaque niveau ÷ capacité moyenne d’une classe (arrondi au supérieur).', 'Enseignants nécessaires = heures hebdomadaires totales (classes × heures moyennes d’une classe) ÷ charge cible par enseignant.',
      'Salles nécessaires = heures totales ÷ (heures d’ouverture × 80 %).', `Tarifs de l'année suivante = tarifs actuels + ${AUGMENTATION} TND sur la scolarité par niveau (règle du module Tarifs).`,
      'Recettes prévues = effectif × tarif × taux de recouvrement (+ frais d’inscription des nouveaux). Dépenses = enseignants × coût mensuel × 12 + élèves × charges par élève.'],
  };
}
async function simulation(ctx, params) { const S = await strat(ctx); return { annee_suivante: S.prev.annee_suivante, actuel: simuler(S, {}), simulation: simuler(S, params) }; }

module.exports = { inscriptions, communication, edt, risques, strategique, simulation };

// Statistiques d'UNE école (page « Statistiques de l'école » du directeur).
//
// Isolation à deux niveaux :
//  1. Les requêtes passent par `q` : PostgreSQL applique la Row Level Security avec l'école de la session (rôle `ecole_app`).
//  2. Chaque requête filtre en plus explicitement sur `school_id = $1`, et chaque jointure vérifie que les deux lignes
//     appartiennent à la MÊME école (`… AND x.school_id = y.school_id`). Une relation incohérente ne peut donc jamais
//     faire entrer une donnée d'une autre école dans les chiffres.
// L'identifiant de l'école vient toujours du compte connecté (revérifié en base par `auth`), jamais de l'adresse ou du formulaire.
//
// Tout est calculé en base à chaque appel (aucun cache). Les données « de l'année » concernent l'année scolaire courante.
// Remarque sur les présences : l'application n'enregistre que les ABSENCES (l'appel marque les absents). Les présences sont donc
// déduites : élèves actifs scolarisés moins élèves absents.
const { q } = require('../db');
const config = require('../config');
const { HttpError } = require('../util');
const { libelleEcole } = require('../libelle-ecole');
const A = require('./absences');
const { assurerTarifsAnnee } = require('./tarifs');
const { LIMITES } = require('./quotas');

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const lim = (v) => (v === Infinity ? null : v);

// Jours de classe (lundi à samedi : l'école est fermée le dimanche) entre deux dates ISO incluses
function joursOuvres(debut, fin) {
  let c = 0;
  for (const d = new Date(`${debut}T12:00:00Z`); d.toISOString().slice(0, 10) <= fin; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) c++;
  return c;
}
// Mois (YYYY-MM) de l'année scolaire « 2026-2027 » écoulés jusqu'à `jusqua` : septembre … août
function moisAnnee(annee, jusqua) {
  const d = Number(String(annee).slice(0, 4));
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((8 + i) % 12) + 1; const y = m >= 9 ? d : d + 1;
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k <= jusqua.slice(0, 7)) out.push(k);
  }
  return out;
}

async function statsEcole(schoolId) {
  const id = Number(schoolId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(403, "Aucune école n'est rattachée à ce compte");
  const annee = config.anneeCourante;
  const today = A.aujourdhui();
  const moisDebut = `${today.slice(0, 7)}-01`;
  const rows = async (sql, p) => (await q(sql, p)).rows;
  const one = async (sql, p) => (await q(sql, p)).rows[0] || {};

  await assurerTarifsAnnee(annee); // même préparation que le tableau de bord : les montants dus sont identiques

  const [ecole, users, eleves, classes, classesTotal, pers, abs, absMois, absAuj, absPoids, pay, payMode, payMois, payCeMois, dues,
    evals, devoirs, msgs, annonces, pre] = await Promise.all([
    one('SELECT id, nom, slug, ville, status, plan, subscription_end FROM schools WHERE id=$1', [id]),
    rows('SELECT role, actif, COUNT(*) n FROM users WHERE school_id=$1 AND deleted_at IS NULL GROUP BY 1,2', [id]),
    rows(`SELECT e.statut, COALESCE(e.sexe,'?') sexe, (c.id IS NOT NULL) en_classe, COUNT(*) n
          FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id AND c.school_id=e.school_id
          WHERE e.school_id=$1 AND e.deleted_at IS NULL GROUP BY 1,2,3`, [id]),
    rows(`SELECT c.id, c.niveau, c.section, c.capacite, NULLIF(trim(COALESCE(u.prenom,'')||' '||COALESCE(u.nom,'')),'') titulaire,
            (SELECT COUNT(*) FROM eleves e WHERE e.school_id=c.school_id AND e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='actif') effectif,
            (SELECT COUNT(*) FROM absences a JOIN eleves e ON e.id=a.eleve_id AND e.school_id=a.school_id
              WHERE a.school_id=c.school_id AND e.classe_id=c.id AND a.deleted_at IS NULL AND a.annee_scolaire=$2) absences
          FROM classes c LEFT JOIN users u ON u.id=c.titulaire_id AND u.school_id=c.school_id
          WHERE c.school_id=$1 AND c.deleted_at IS NULL AND c.annee_scolaire=$2 ORDER BY c.niveau, c.section`, [id, annee]),
    one('SELECT COUNT(*) n FROM classes WHERE school_id=$1 AND deleted_at IS NULL', [id]),
    one(`SELECT
           (SELECT COUNT(*) FROM matieres WHERE school_id=$1 AND deleted_at IS NULL) matieres,
           (SELECT COUNT(*) FROM salles WHERE school_id=$1 AND deleted_at IS NULL) salles,
           (SELECT COUNT(*) FROM affectations WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2) affectations,
           (SELECT COUNT(DISTINCT enseignant_id) FROM affectations WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2) enseignants_affectes,
           (SELECT COUNT(*) FROM creneaux WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2) creneaux`, [id, annee]),
    one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE a.justifiee) justifiees, COUNT(DISTINCT a.eleve_id) eleves_concernes,
                COUNT(*) FILTER (WHERE a.date_absence=$3::date) aujourdhui,
                COUNT(*) FILTER (WHERE a.date_absence>=$4::date AND a.date_absence<=$3::date) ce_mois
         FROM absences a JOIN eleves e ON e.id=a.eleve_id AND e.school_id=a.school_id
         WHERE a.school_id=$1 AND a.deleted_at IS NULL AND a.annee_scolaire=$2`, [id, annee, today, moisDebut]),
    rows(`SELECT to_char(a.date_absence,'YYYY-MM') mois, COUNT(*) n, COUNT(*) FILTER (WHERE a.justifiee) justifiees
          FROM absences a JOIN eleves e ON e.id=a.eleve_id AND e.school_id=a.school_id
          WHERE a.school_id=$1 AND a.deleted_at IS NULL AND a.annee_scolaire=$2 GROUP BY 1`, [id, annee]),
    one(`SELECT COUNT(DISTINCT a.eleve_id) n FROM absences a
         JOIN eleves e ON e.id=a.eleve_id AND e.school_id=a.school_id AND e.statut='actif' AND e.deleted_at IS NULL AND e.classe_id IS NOT NULL
         WHERE a.school_id=$1 AND a.deleted_at IS NULL AND a.date_absence=$2::date`, [id, today]),
    one(`SELECT COALESCE(SUM(CASE a.periode WHEN 'journee' THEN 1 ELSE 0.5 END),0) w FROM absences a
         JOIN eleves e ON e.id=a.eleve_id AND e.school_id=a.school_id AND e.statut='actif' AND e.deleted_at IS NULL AND e.classe_id IS NOT NULL
         WHERE a.school_id=$1 AND a.deleted_at IS NULL AND a.date_absence BETWEEN $2::date AND $3::date AND EXTRACT(DOW FROM a.date_absence)<>0`, [id, moisDebut, today]),
    one(`SELECT COUNT(*) nb, COALESCE(SUM(p.montant),0) total, COUNT(DISTINCT p.eleve_id) eleves_payeurs
         FROM paiements p JOIN eleves e ON e.id=p.eleve_id AND e.school_id=p.school_id
         WHERE p.school_id=$1 AND p.deleted_at IS NULL AND p.annee_scolaire=$2`, [id, annee]),
    rows(`SELECT p.mode, COUNT(*) nb, COALESCE(SUM(p.montant),0) total
          FROM paiements p JOIN eleves e ON e.id=p.eleve_id AND e.school_id=p.school_id
          WHERE p.school_id=$1 AND p.deleted_at IS NULL AND p.annee_scolaire=$2 GROUP BY 1`, [id, annee]),
    rows(`SELECT to_char(p.date_paiement,'YYYY-MM') mois, COUNT(*) nb, COALESCE(SUM(p.montant),0) total
          FROM paiements p JOIN eleves e ON e.id=p.eleve_id AND e.school_id=p.school_id
          WHERE p.school_id=$1 AND p.deleted_at IS NULL AND p.annee_scolaire=$2 GROUP BY 1`, [id, annee]),
    one(`SELECT COALESCE(SUM(montant),0) total FROM paiements
         WHERE school_id=$1 AND deleted_at IS NULL AND date_paiement>=$2::date AND date_paiement<($2::date + interval '1 month')`, [id, moisDebut]),
    // Montants dus / payés des élèves ACTIFS : mêmes formules que « Élèves avec impayé » du tableau de bord (services/finance.js)
    one(`SELECT COUNT(*) FILTER (WHERE ROUND(du-paye,2)>0) eleves_impaye,
                COALESCE(SUM(GREATEST(ROUND(du-paye,2),0)),0) total_impaye, COALESCE(SUM(du),0) total_du, COALESCE(SUM(paye),0) total_paye
         FROM (SELECT
                 COALESCE((SELECT SUM(t.montant) FROM tarifs t WHERE t.school_id=e.school_id AND t.deleted_at IS NULL AND t.annee_scolaire=$2
                           AND (t.niveau IS NULL OR t.niveau='' OR t.niveau=c.niveau)),0) du,
                 COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.school_id=e.school_id AND p.eleve_id=e.id AND p.deleted_at IS NULL AND p.annee_scolaire=$2),0) paye
               FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id AND c.school_id=e.school_id
               WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.statut='actif') x`, [id, annee]),
    one(`SELECT (SELECT COUNT(*) FROM evaluations WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2) evaluations,
                COUNT(*) notes, ROUND(AVG(n.valeur/ev.bareme*20),2) moyenne
         FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.school_id=n.school_id AND ev.deleted_at IS NULL
         WHERE n.school_id=$1 AND n.deleted_at IS NULL AND ev.annee_scolaire=$2`, [id, annee]),
    one(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE date_remise>now()) en_cours,
                (SELECT COUNT(*) FROM depots dp JOIN devoirs d2 ON d2.id=dp.devoir_id AND d2.school_id=dp.school_id
                 WHERE dp.school_id=$1 AND d2.deleted_at IS NULL AND d2.annee_scolaire=$2) depots
         FROM devoirs WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2`, [id, annee]),
    one("SELECT COUNT(*) n FROM messages WHERE school_id=$1 AND statut='envoye'", [id]),
    one('SELECT COUNT(*) n FROM annonces WHERE school_id=$1', [id]),
    rows('SELECT statut, COUNT(*) n FROM preinscriptions WHERE school_id=$1 AND deleted_at IS NULL GROUP BY 1', [id]),
  ]);
  if (!ecole.id) throw new HttpError(404, 'École introuvable');

  // ----- Utilisateurs -----
  const role = (r) => users.filter((x) => x.role === r).reduce((t, x) => t + n(x.n), 0);
  const utilisateurs = users.reduce((t, x) => t + n(x.n), 0);
  const actifs = users.filter((x) => x.actif).reduce((t, x) => t + n(x.n), 0);
  // ----- Élèves -----
  const E = (f) => eleves.filter(f).reduce((t, x) => t + n(x.n), 0);
  const nbEleves = E(() => true);
  const elevesActifs = E((x) => x.statut === 'actif');
  const actifsEnClasse = E((x) => x.statut === 'actif' && x.en_classe);
  // ----- Absences / présences -----
  const jours = joursOuvres(moisDebut, today);
  const fermee = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
  const absentsAuj = n(absAuj.n);
  const poids = n(absPoids.w);
  const tauxMois = jours > 0 && actifsEnClasse > 0 ? Math.max(0, Math.min(100, Math.round((1 - poids / (actifsEnClasse * jours)) * 1000) / 10)) : null;
  const mois = moisAnnee(annee, today);
  const aM = Object.fromEntries(absMois.map((x) => [x.mois, x])); const pM = Object.fromEntries(payMois.map((x) => [x.mois, x]));
  // ----- Finances -----
  const totalDu = r2(dues.total_du); const totalImpaye = r2(dues.total_impaye);
  const prein = Object.fromEntries(pre.map((x) => [x.statut, n(x.n)]));
  const lq = LIMITES[ecole.plan] || LIMITES.basic;

  return {
    genere_le: new Date().toISOString(), annee, aujourdhui: today,
    ecole: { id: ecole.id, nom: ecole.nom, label: libelleEcole(ecole), slug: ecole.slug, ville: ecole.ville, status: ecole.status, plan: ecole.plan, subscription_end: ecole.subscription_end },
    utilisateurs: {
      total: utilisateurs, actifs, inactifs: utilisateurs - actifs,
      directeurs: role('admin'), enseignants: role('enseignant'), parents: role('parent'), comptables: role('comptable'), comptes_eleves: role('eleve'),
    },
    eleves: {
      total: nbEleves, actifs: elevesActifs, inactifs: E((x) => x.statut === 'inactif'), diplomes: E((x) => x.statut === 'diplome'),
      garcons: E((x) => x.sexe === 'M'), filles: E((x) => x.sexe === 'F'), sexe_non_renseigne: E((x) => x.sexe === '?'),
      actifs_sans_classe: E((x) => x.statut === 'actif' && !x.en_classe), actifs_en_classe: actifsEnClasse,
    },
    classes: {
      annee: classes.length, toutes_annees: n(classesTotal.n),
      capacite_totale: classes.reduce((t, c) => t + n(c.capacite), 0),
      liste: classes.map((c) => ({
        id: c.id, nom: `${c.niveau}${c.section ? ` ${c.section}` : ''}`, titulaire: c.titulaire, capacite: n(c.capacite), effectif: n(c.effectif),
        remplissage: pct(n(c.effectif), n(c.capacite)), absences: n(c.absences),
      })),
    },
    personnel: {
      enseignants: role('enseignant'), enseignants_affectes: n(pers.enseignants_affectes), matieres: n(pers.matieres), salles: n(pers.salles),
      affectations: n(pers.affectations), creneaux: n(pers.creneaux),
    },
    absences: {
      total: n(abs.total), justifiees: n(abs.justifiees), non_justifiees: n(abs.total) - n(abs.justifiees), eleves_concernes: n(abs.eleves_concernes),
      aujourdhui: n(abs.aujourdhui), ce_mois: n(abs.ce_mois),
      par_mois: mois.map((m) => ({ mois: m, total: n(aM[m]?.n), justifiees: n(aM[m]?.justifiees) })),
    },
    presences: {
      // Déduites des absences (voir l'en-tête du fichier). `null` = non calculable (école fermée le dimanche, aucun élève scolarisé…)
      eleves_scolarises: actifsEnClasse, ecole_fermee: fermee,
      absents_aujourdhui: fermee ? null : absentsAuj,
      presents_aujourdhui: fermee ? null : Math.max(0, actifsEnClasse - absentsAuj),
      taux_aujourdhui: fermee ? null : pct(Math.max(0, actifsEnClasse - absentsAuj), actifsEnClasse),
      jours_de_classe_ce_mois: jours, taux_mois: tauxMois,
    },
    paiements: {
      nombre: n(pay.nb), total_encaisse: r2(pay.total), encaisse_ce_mois: r2(payCeMois.total), eleves_payeurs: n(pay.eleves_payeurs),
      total_du: totalDu, total_paye_eleves_actifs: r2(dues.total_paye), total_impaye: totalImpaye, eleves_avec_impaye: n(dues.eleves_impaye),
      taux_recouvrement: totalDu > 0 ? Math.max(0, Math.min(100, Math.round(((totalDu - totalImpaye) / totalDu) * 100))) : null,
      par_mode: payMode.map((x) => ({ mode: x.mode, nombre: n(x.nb), total: r2(x.total) })),
      par_mois: mois.map((m) => ({ mois: m, nombre: n(pM[m]?.nb), total: r2(pM[m]?.total) })),
    },
    evaluations: { evaluations: n(evals.evaluations), notes: n(evals.notes), moyenne_sur_20: evals.moyenne === null || evals.moyenne === undefined ? null : Number(evals.moyenne) },
    devoirs: { total: n(devoirs.total), en_cours: n(devoirs.en_cours), depots: n(devoirs.depots) },
    communication: { messages_envoyes: n(msgs.n), annonces: n(annonces.n) },
    preinscriptions: { en_attente: n(prein.en_attente), validees: n(prein.validee), refusees: n(prein.refusee), total: pre.reduce((t, x) => t + n(x.n), 0) },
    abonnement: {
      formule: ecole.plan, statut: ecole.status, fin: ecole.subscription_end,
      quota_eleves: { utilise: nbEleves, limite: lim(lq.eleves) },
      quota_utilisateurs: { utilise: utilisateurs - role('eleve'), limite: lim(lq.utilisateurs) }, // les comptes élèves comptent dans le quota « élèves »
    },
  };
}

module.exports = { statsEcole };

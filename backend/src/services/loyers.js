// Finances du PROPRIÉTAIRE : loyers des écoles.
//  - loyer_echeances      = loyer PRÉVU (une ligne par école et par mois)
//  - loyer_encaissements  = loyer RÉELLEMENT ENCAISSÉ (une ligne par versement)
// Règle d'or : seuls les encaissements sont des revenus. Une échéance impayée n'est JAMAIS comptée comme encaissée.
const { qa, txa } = require('../db');
const { HttpError } = require('../util');
const V = require('./validate');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const aujourdhui = () => V.aujourdhui();
const MODES = ['especes', 'virement', 'cheque', 'mobile_money'];
const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const HORIZON_MOIS = 12; // les échéances sont générées jusqu'à 12 mois dans le futur (ou la fin du contrat)

const premierDuMois = (iso) => `${iso.slice(0, 7)}-01`;
function ajouterMois(iso, n) { const [y, m] = iso.slice(0, 7).split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`; }
const joursEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

// Statut d'une échéance : paye / en_retard / en_attente (partiel = versement incomplet, indiqué à part)
function statut(e, today = aujourdhui()) {
  const reste = r2(e.montant_du - e.paye);
  if (reste <= 0) return 'paye';
  return e.echeance < today ? 'en_retard' : 'en_attente';
}

function validerContrat(b) {
  const loyer = V.nombre(b.loyer_mensuel, 'Le loyer mensuel', { min: 0, max: 1000000, required: true });
  const jour = V.nombre(b.jour_echeance ?? 5, "Le jour d'échéance", { min: 1, max: 28, entier: true, required: true });
  const debut = V.date(b.date_debut, 'La date de début du contrat', { required: true });
  const fin = V.date(b.date_fin, 'La date de fin du contrat');
  if (fin && fin < debut) throw new HttpError(400, 'La date de fin du contrat doit suivre la date de début');
  const caution = V.nombre(b.caution, 'La caution', { min: 0, max: 10000000 });
  const notes = V.texte(b.notes, 'Les notes', { max: 1000, multiligne: true });
  return { loyer_mensuel: loyer, jour_echeance: jour, date_debut: debut, date_fin: fin, caution, notes };
}

// Crée/complète les échéances mensuelles du contrat (idempotent) ; ajuste les mois non encore touchés si le loyer change
async function genererEcheances(cl, schoolId) {
  const c = (await cl.query('SELECT * FROM school_contracts WHERE school_id=$1', [schoolId])).rows[0];
  if (!c) return 0;
  const debut = premierDuMois(String(c.date_debut).slice(0, 10));
  let limite = ajouterMois(aujourdhui(), HORIZON_MOIS);
  if (c.date_fin) { const f = premierDuMois(String(c.date_fin).slice(0, 10)); if (f < limite) limite = f; }
  let n = 0;
  for (let p = debut; p <= limite; p = ajouterMois(p, 1)) {
    const ech = `${p.slice(0, 8)}${pad(c.jour_echeance)}`;
    const r = await cl.query('INSERT INTO loyer_echeances(school_id,periode,echeance,montant_du) VALUES ($1,$2,$3,$4) ON CONFLICT (school_id,periode) DO NOTHING', [schoolId, p, ech, c.loyer_mensuel]);
    n += r.rowCount;
  }
  // Loyer ou jour modifiés : seules les échéances SANS versement et à partir du mois courant sont ajustées (l'historique reste intact)
  await cl.query(`UPDATE loyer_echeances e SET montant_du=$2, echeance=(to_char(e.periode,'YYYY-MM-')||lpad($3::text,2,'0'))::date
                  WHERE e.school_id=$1 AND e.periode>=date_trunc('month',$4::date) AND NOT EXISTS (SELECT 1 FROM loyer_encaissements p WHERE p.echeance_id=e.id)`,
    [schoolId, c.loyer_mensuel, c.jour_echeance, aujourdhui()]);
  // Échéances au-delà de la fin du contrat : retirées seulement si aucun versement
  if (c.date_fin) await cl.query('DELETE FROM loyer_echeances e WHERE e.school_id=$1 AND e.periode>$2 AND NOT EXISTS (SELECT 1 FROM loyer_encaissements p WHERE p.echeance_id=e.id)', [schoolId, premierDuMois(String(c.date_fin).slice(0, 10))]);
  // Échéances avant le début : idem
  await cl.query('DELETE FROM loyer_echeances e WHERE e.school_id=$1 AND e.periode<$2 AND NOT EXISTS (SELECT 1 FROM loyer_encaissements p WHERE p.echeance_id=e.id)', [schoolId, debut]);
  return n;
}

async function enregistrerContrat(schoolId, body) {
  const c = validerContrat(body || {});
  return txa(async (cl) => {
    await cl.query(
      `INSERT INTO school_contracts(school_id,loyer_mensuel,jour_echeance,date_debut,date_fin,caution,notes,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (school_id) DO UPDATE SET loyer_mensuel=EXCLUDED.loyer_mensuel, jour_echeance=EXCLUDED.jour_echeance, date_debut=EXCLUDED.date_debut,
         date_fin=EXCLUDED.date_fin, caution=EXCLUDED.caution, notes=EXCLUDED.notes, updated_at=now()`,
      [schoolId, c.loyer_mensuel, c.jour_echeance, c.date_debut, c.date_fin, c.caution, c.notes]);
    await genererEcheances(cl, schoolId);
    return (await cl.query('SELECT * FROM school_contracts WHERE school_id=$1', [schoolId])).rows[0];
  });
}

// Complète les échéances de tous les contrats (appelé avant chaque calcul : les mois à venir apparaissent tout seuls)
async function assurerEcheances() {
  const ids = (await qa('SELECT school_id FROM school_contracts')).rows.map((r) => r.school_id);
  for (const id of ids) await txa((cl) => genererEcheances(cl, id));
}

const filtreEcheances = (f, params) => {
  const w = ['TRUE'];
  if (f.ecoleId) { params.push(f.ecoleId); w.push(`e.school_id=$${params.length}`); }
  if (f.annee) { params.push(f.annee); w.push(`EXTRACT(YEAR FROM e.periode)=$${params.length}`); }
  if (f.mois) { params.push(f.mois); w.push(`EXTRACT(MONTH FROM e.periode)=$${params.length}`); }
  return w.join(' AND ');
};

async function statistiques({ ecoleId = null, annee = null, mois = null } = {}) {
  await assurerEcheances();
  const today = aujourdhui();
  const f = { ecoleId, annee, mois };
  const p1 = []; const w1 = filtreEcheances(f, p1);
  const ech = (await qa(
    `SELECT e.id, e.school_id, e.periode, e.echeance, e.montant_du, COALESCE(SUM(p.montant),0) AS paye, s.nom, s.ville, s.slug
       FROM loyer_echeances e JOIN schools s ON s.id=e.school_id LEFT JOIN loyer_encaissements p ON p.echeance_id=e.id
      WHERE ${w1} GROUP BY e.id, s.id ORDER BY e.periode, s.nom`, p1)).rows
    .map((e) => ({ ...e, periode: String(e.periode).slice(0, 10), echeance: String(e.echeance).slice(0, 10), montant_du: r2(e.montant_du), paye: r2(e.paye) }))
    .map((e) => ({ ...e, reste: r2(Math.max(0, e.montant_du - e.paye)), statut: statut(e, today), partiel: e.paye > 0 && e.paye < e.montant_du }));

  // Encaissements réels (par date de paiement) selon les mêmes filtres
  const p2 = []; const w2 = ['TRUE'];
  if (ecoleId) { p2.push(ecoleId); w2.push(`p.school_id=$${p2.length}`); }
  if (annee) { p2.push(annee); w2.push(`EXTRACT(YEAR FROM p.date_paiement)=$${p2.length}`); }
  if (mois) { p2.push(mois); w2.push(`EXTRACT(MONTH FROM p.date_paiement)=$${p2.length}`); }
  const enc = (await qa(
    `SELECT p.id, p.school_id, p.montant, p.date_paiement, p.mode, p.reference, p.notes, e.periode, s.nom, s.ville
       FROM loyer_encaissements p JOIN loyer_echeances e ON e.id=p.echeance_id JOIN schools s ON s.id=p.school_id
      WHERE ${w2.join(' AND ')} ORDER BY p.date_paiement DESC, p.id DESC`, p2)).rows
    .map((p) => ({ ...p, montant: r2(p.montant), date_paiement: String(p.date_paiement).slice(0, 10), periode: String(p.periode).slice(0, 10) }));

  const contrats = (await qa('SELECT c.*, s.nom, s.ville FROM school_contracts c JOIN schools s ON s.id=c.school_id' + (ecoleId ? ' WHERE c.school_id=$1' : ''), ecoleId ? [ecoleId] : [])).rows;
  const label = (x) => (x.ville ? `${x.nom} (${x.ville})` : x.nom);
  const somme = (arr, k) => r2(arr.reduce((t, x) => t + x[k], 0));

  const par_ecole = contrats.map((c) => {
    const mine = ech.filter((e) => e.school_id === c.school_id); const encs = enc.filter((p) => p.school_id === c.school_id);
    const dues = mine.filter((e) => e.echeance <= today);
    return {
      school_id: c.school_id, ecole: label(c), loyer_mensuel: r2(c.loyer_mensuel),
      prevu: somme(mine, 'montant_du'), encaisse: somme(encs, 'montant'),
      impaye: somme(mine.filter((e) => e.statut === 'en_retard'), 'reste'), a_venir: somme(mine.filter((e) => e.statut === 'en_attente'), 'reste'),
      echeances_payees: mine.filter((e) => e.statut === 'paye').length, echeances_en_attente: mine.filter((e) => e.statut === 'en_attente').length,
      echeances_en_retard: mine.filter((e) => e.statut === 'en_retard').length,
      taux_recouvrement: dues.length && somme(dues, 'montant_du') > 0 ? Math.round((somme(dues, 'paye') / somme(dues, 'montant_du')) * 1000) / 10 : null,
    };
  }).sort((a, b) => b.encaisse - a.encaisse || a.ecole.localeCompare(b.ecole, 'fr'));

  // Série mensuelle de l'année : prévu (par mois de loyer) et encaissé (par date de versement)
  const y = Number(annee) || Number(today.slice(0, 4));
  const mensuel = MOIS.map((nom, i) => {
    const m = i + 1;
    return { mois: m, nom,
      prevu: somme(ech.filter((e) => Number(e.periode.slice(0, 4)) === y && Number(e.periode.slice(5, 7)) === m), 'montant_du'),
      encaisse: somme(enc.filter((p) => Number(p.date_paiement.slice(0, 4)) === y && Number(p.date_paiement.slice(5, 7)) === m), 'montant') };
  });

  const enRetard = ech.filter((e) => e.statut === 'en_retard');
  const retards = enRetard.map((e) => ({ echeance_id: e.id, school_id: e.school_id, ecole: label(e), periode: e.periode, echeance: e.echeance, reste: e.reste, jours_retard: joursEntre(e.echeance, today) }))
    .sort((a, b) => b.jours_retard - a.jours_retard);
  const prochaines = ech.filter((e) => e.statut === 'en_attente').sort((a, b) => a.echeance.localeCompare(b.echeance) || a.nom.localeCompare(b.nom))
    .slice(0, 20).map((e) => ({ echeance_id: e.id, school_id: e.school_id, ecole: label(e), periode: e.periode, echeance: e.echeance, reste: e.reste, jours_restants: joursEntre(today, e.echeance) }));

  return {
    genere_le: new Date().toISOString(), filtres: { ecole_id: ecoleId, annee: annee || null, mois: mois || null },
    totaux: {
      loyer_mensuel_total: somme(contrats.map((c) => ({ v: r2(c.loyer_mensuel) })), 'v'),
      prevu: somme(ech, 'montant_du'),
      encaisse: somme(enc, 'montant'),                                  // revenus RÉELS
      impaye: somme(enRetard, 'reste'),                                 // échéance dépassée, non réglée
      en_attente: somme(ech.filter((e) => e.statut === 'en_attente'), 'reste'), // pas encore échu
      nb_payees: ech.filter((e) => e.statut === 'paye').length, nb_en_attente: ech.filter((e) => e.statut === 'en_attente').length, nb_en_retard: enRetard.length,
    },
    par_ecole, mensuel, retards, prochaines, historique: enc.slice(0, 100).map((p) => ({ id: p.id, school_id: p.school_id, ecole: label(p), montant: p.montant, date_paiement: p.date_paiement, mode: p.mode, reference: p.reference, periode: p.periode })),
    echeances: ecoleId ? ech.map((e) => ({ id: e.id, periode: e.periode, echeance: e.echeance, montant_du: e.montant_du, paye: e.paye, reste: e.reste, statut: e.statut, partiel: e.partiel })) : undefined,
  };
}

async function annesDisponibles() {
  const { rows } = await qa("SELECT DISTINCT EXTRACT(YEAR FROM periode)::int AS a FROM loyer_echeances ORDER BY a DESC");
  const cur = Number(aujourdhui().slice(0, 4));
  const set = new Set([cur, ...rows.map((r) => r.a)]);
  return [...set].sort((a, b) => b - a);
}

async function encaisser(echeanceId, b, userId) {
  const montant = V.nombre(b.montant, 'Le montant', { min: 0.01, max: 10000000, required: true });
  const date = V.date(b.date_paiement || aujourdhui(), 'La date de paiement', { max: aujourdhui(), required: true });
  const mode = V.choix(b.mode, 'Le mode de paiement', MODES, { required: true });
  const reference = V.texte(b.reference, 'La référence', { max: 60, re: /^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u, reMsg: 'La référence : lettres, chiffres, espaces et . _ / - uniquement' });
  if (mode !== 'especes' && !reference) throw new HttpError(400, 'La référence est obligatoire pour ce mode de paiement');
  const notes = V.texte(b.notes, 'Les notes', { max: 500, multiligne: true });
  return txa(async (cl) => {
    const e = (await cl.query('SELECT * FROM loyer_echeances WHERE id=$1 FOR UPDATE', [echeanceId])).rows[0];
    if (!e) throw new HttpError(404, 'Échéance introuvable');
    const deja = r2((await cl.query('SELECT COALESCE(SUM(montant),0) s FROM loyer_encaissements WHERE echeance_id=$1', [e.id])).rows[0].s);
    const reste = r2(e.montant_du - deja);
    if (reste <= 0) throw new HttpError(409, 'Cette échéance est déjà entièrement réglée');
    if (montant > reste + 1e-9) throw new HttpError(400, `Le montant dépasse le reste à payer (${reste.toFixed(2)} TND)`);
    const p = (await cl.query('INSERT INTO loyer_encaissements(echeance_id,school_id,montant,date_paiement,mode,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [e.id, e.school_id, montant, date, mode, reference, notes, userId])).rows[0];
    return { ...p, montant: r2(p.montant), reste_apres: r2(reste - montant), school_id: e.school_id };
  });
}

module.exports = { enregistrerContrat, genererEcheances, assurerEcheances, statistiques, encaisser, annesDisponibles, statut, MODES, r2 };

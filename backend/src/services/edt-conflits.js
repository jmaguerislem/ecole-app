// Détection des conflits d'emploi du temps (appelée à la création, à la modification ET par la pré-vérification de l'interface).
//   Règle 1 : une salle ne peut pas servir à deux séances qui se chevauchent (même école, ou écoles d'un même SITE : même nom de salle = même local).
//   Règle 2 : un enseignant ne peut pas avoir deux séances qui se chevauchent (toutes les classes / tous les emplois du temps de l'école).
//   Règle 3 (existante) : une classe ne peut pas avoir deux cours en même temps.
// Chevauchement : début < fin_autre ET fin > début_autre (deux séances bout à bout, 08:00-09:00 puis 09:00-10:00, sont acceptées).
const { qa } = require('../db');
const { HttpError } = require('../util');

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (t) => String(t).slice(0, 5);
const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const chevauche = (a1, a2, b1, b2) => a1 < b2 && a2 > b1;
const normSalle = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normSite = normSalle;

// Sérialise les écritures d'un même jour (plateforme entière) : deux utilisateurs simultanés ne peuvent plus passer le contrôle en même temps.
async function verrouiller(client, jour) { await client.query('SELECT pg_advisory_xact_lock(7001, $1::int)', [Number(jour)]); }

// Séances d'autres établissements du même site occupant la même salle (nom normalisé). Aucune donnée privée n'est renvoyée.
async function occupationsSite(schoolId, salleNom, annee, jours) {
  if (!salleNom) return [];
  const me = (await qa('SELECT site FROM schools WHERE id=$1', [schoolId])).rows[0];
  if (!me?.site || !String(me.site).trim()) return [];
  const { rows } = await qa(
    `SELECT t.jour, t.heure_debut, t.heure_fin FROM creneaux t
       JOIN salles s ON s.id=t.salle_id JOIN schools sc ON sc.id=t.school_id
      WHERE t.deleted_at IS NULL AND s.deleted_at IS NULL AND t.school_id<>$1 AND t.annee_scolaire=$2 AND t.jour = ANY($3::int[])
        AND lower(trim(sc.site))=$4 AND lower(regexp_replace(trim(s.nom),'\\s+',' ','g'))=$5`,
    [schoolId, annee, jours, normSite(me.site), normSalle(salleNom)]);
  return rows.map((r) => ({ jour: r.jour, debut: hm(r.heure_debut), fin: hm(r.heure_fin) }));
}

// m : { id?, classe_id, matiere_id, enseignant_id, salle_id, jour, heure_debut, heure_fin, annee_scolaire } ; client : client SQL de l'école (RLS)
async function trouverConflits(client, m, schoolId, { exclureId = 0 } = {}) {
  const jour = Number(m.jour); const d = hm(m.heure_debut); const f = hm(m.heure_fin);
  const { rows } = await client.query(
    `SELECT t.id, t.enseignant_id, t.salle_id, t.classe_id, t.heure_debut, t.heure_fin,
            mt.nom AS matiere, c.niveau||COALESCE(' '||c.section,'') AS classe, u.nom||' '||u.prenom AS enseignant, s.nom AS salle
       FROM creneaux t JOIN matieres mt ON mt.id=t.matiere_id JOIN classes c ON c.id=t.classe_id JOIN users u ON u.id=t.enseignant_id LEFT JOIN salles s ON s.id=t.salle_id
      WHERE t.deleted_at IS NULL AND t.annee_scolaire=$1 AND t.jour=$2 AND t.heure_debut<$4 AND t.heure_fin>$3 AND t.id<>$5
        AND (t.enseignant_id=$6 OR (t.salle_id IS NOT NULL AND t.salle_id=$7) OR t.classe_id=$8)
      ORDER BY t.heure_debut`,
    [m.annee_scolaire, jour, d, f, exclureId, m.enseignant_id, m.salle_id || null, m.classe_id]);
  const J = JOURS[jour - 1]; const out = [];
  const ajoute = (type, r, message) => out.push({ type, jour, jour_nom: J, debut: hm(r.heure_debut), fin: hm(r.heure_fin), creneau_id: r.id, message });
  const ens = rows.find((r) => Number(r.enseignant_id) === Number(m.enseignant_id));
  if (ens) ajoute('enseignant', ens, `L'enseignant ${ens.enseignant} est déjà affecté le ${J} de ${hm(ens.heure_debut)} à ${hm(ens.heure_fin)} à la classe ${ens.classe} (${ens.matiere}).`);
  const sal = m.salle_id ? rows.find((r) => r.salle_id && Number(r.salle_id) === Number(m.salle_id)) : null;
  if (sal) ajoute('salle', sal, `La salle « ${sal.salle} » est déjà réservée le ${J} de ${hm(sal.heure_debut)} à ${hm(sal.heure_fin)} (classe ${sal.classe}, ${sal.matiere}).`);
  const cls = rows.find((r) => Number(r.classe_id) === Number(m.classe_id));
  if (cls) ajoute('classe', cls, `La classe ${cls.classe} a déjà cours le ${J} de ${hm(cls.heure_debut)} à ${hm(cls.heure_fin)} (${cls.matiere}).`);
  // Salle partagée avec une autre école du même site
  if (m.salle_id && !sal) {
    const sn = (await client.query('SELECT nom FROM salles WHERE id=$1', [m.salle_id])).rows[0];
    const autres = (await occupationsSite(schoolId, sn?.nom, m.annee_scolaire, [jour])).filter((o) => chevauche(d, f, o.debut, o.fin));
    if (autres[0]) out.push({ type: 'salle', jour, jour_nom: J, debut: autres[0].debut, fin: autres[0].fin, creneau_id: null, autre_etablissement: true,
      message: `La salle « ${sn.nom} » est déjà réservée le ${J} de ${autres[0].debut} à ${autres[0].fin} par un autre établissement qui partage ce local.` });
  }
  return out;
}

// Propositions : salles libres sur le créneau demandé, puis créneaux libres (même durée) pour l'enseignant, la classe et la salle
async function suggerer(client, m, schoolId, { exclureId = 0 } = {}) {
  const d = min(hm(m.heure_debut)); const f = min(hm(m.heure_fin)); const duree = f - d; const annee = m.annee_scolaire;
  const salles = (await client.query('SELECT id, nom FROM salles WHERE deleted_at IS NULL AND disponible ORDER BY nom')).rows;
  const occ = (await client.query(
    `SELECT jour, heure_debut, heure_fin, enseignant_id, classe_id, salle_id FROM creneaux WHERE deleted_at IS NULL AND annee_scolaire=$1 AND id<>$2`, [annee, exclureId])).rows
    .map((r) => ({ ...r, a: min(hm(r.heure_debut)), b: min(hm(r.heure_fin)) }));
  const sallesSite = new Map(); // salle.id -> occupations d'autres écoles du même site
  for (const s of salles) sallesSite.set(s.id, await occupationsSite(schoolId, s.nom, annee, [1, 2, 3, 4, 5, 6]));
  const salleLibre = (s, jour, a, b) => !occ.some((r) => r.jour === jour && Number(r.salle_id) === s.id && chevauche(a, b, r.a, r.b))
    && !(sallesSite.get(s.id) || []).some((o) => o.jour === jour && chevauche(a, b, min(o.debut), min(o.fin)));
  const sallesLibres = salles.filter((s) => salleLibre(s, Number(m.jour), d, f)).slice(0, 5).map((s) => ({ id: s.id, nom: s.nom }));
  const pris = (jour, a, b) => occ.some((r) => r.jour === jour && chevauche(a, b, r.a, r.b) && (Number(r.enseignant_id) === Number(m.enseignant_id) || Number(r.classe_id) === Number(m.classe_id)));
  const creneaux = [];
  const ordre = [Number(m.jour), ...[1, 2, 3, 4, 5, 6].filter((j) => j !== Number(m.jour))];
  for (const jour of ordre) {
    for (let a = 7 * 60; a + duree <= 19 * 60 && creneaux.length < 5; a += 30) {
      const b = a + duree;
      if (jour === Number(m.jour) && chevauche(a, b, d, f)) continue; // le créneau refusé lui-même
      if (pris(jour, a, b)) continue;
      const salle = m.salle_id ? salles.find((s) => s.id === Number(m.salle_id)) : null;
      if (salle && !salleLibre(salle, jour, a, b)) continue;
      creneaux.push({ jour, jour_nom: JOURS[jour - 1], debut: hhmm(a), fin: hhmm(b) });
    }
    if (creneaux.length >= 5) break;
  }
  return { salles: sallesLibres, creneaux };
}

// Lève une 409 détaillée (code, conflits, suggestions) si le créneau est en conflit
async function verifierOuRefuser(client, m, schoolId, opts = {}) {
  const conflits = await trouverConflits(client, m, schoolId, opts);
  if (!conflits.length) return;
  const suggestions = await suggerer(client, m, schoolId, opts);
  const quand = `${conflits[0].jour_nom} ${conflits[0].debut}–${conflits[0].fin}`;
  throw new HttpError(409, `Conflit d'emploi du temps (${quand}) : ${conflits.map((c) => c.message).join(' ')} Choisissez un autre créneau ou une autre salle.`, { code: 'conflit_edt', conflits, suggestions });
}
module.exports = { trouverConflits, suggerer, verifierOuRefuser, verrouiller, JOURS };

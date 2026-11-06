// Tarifs de scolarité : un prix par niveau et par année, +50 DT à chaque nouvelle année scolaire (automatique).
// Les anciens tarifs ne sont jamais écrasés : chaque année garde sa ligne, et `tarifs_historique` trace chaque changement.
const { q, currentSchool } = require('../db');
const config = require('../config');
const V = require('./validate');

const AUGMENTATION = Number(process.env.TARIF_AUGMENTATION_ANNUELLE || 50);
const debut = (a) => Number(String(a).slice(0, 4));
const done = new Set(); // (école, année) déjà traitées dans ce processus

const historiser = (cl, { tarif, ancien = null, nouveau, motif, userId = null }) =>
  cl.query('INSERT INTO tarifs_historique(tarif_id,annee_scolaire,niveau,libelle,type,montant_ancien,montant_nouveau,motif,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [tarif.id, tarif.annee_scolaire, tarif.niveau, tarif.libelle, tarif.type, ancien, nouveau, motif, userId]);

// Crée, pour chaque niveau sans tarif de scolarité pour `annee`, le tarif de la dernière année connue + 50 DT par année écoulée.
async function assurerTarifsAnnee(annee = config.anneeCourante, { force = false } = {}) {
  try { V.annee(annee); } catch { return []; }
  if (!annee || debut(annee) > debut(config.anneeCourante) + 1) return []; // pas de génération pour un futur lointain
  const key = `${currentSchool()?.schoolId || 'x'}:${annee}`;
  if (!force && done.has(key)) return [];
  const crees = [];
  for (const niveau of V.NIVEAUX) {
    if ((await q("SELECT 1 FROM tarifs WHERE type='scolarite' AND niveau=$1 AND annee_scolaire=$2 AND deleted_at IS NULL", [niveau, annee])).rowCount) continue;
    const prev = (await q("SELECT * FROM tarifs WHERE type='scolarite' AND niveau=$1 AND annee_scolaire<$2 AND deleted_at IS NULL ORDER BY annee_scolaire DESC, id DESC LIMIT 1", [niveau, annee])).rows[0];
    if (!prev) continue;
    const montant = Math.round((prev.montant + AUGMENTATION * (debut(annee) - debut(prev.annee_scolaire))) * 100) / 100;
    const t = (await q("INSERT INTO tarifs(annee_scolaire,libelle,type,niveau,montant) VALUES ($1,$2,'scolarite',$3,$4) RETURNING *", [annee, `Scolarité – ${niveau}`, niveau, montant])).rows[0];
    await q('INSERT INTO tarifs_historique(tarif_id,annee_scolaire,niveau,libelle,type,montant_ancien,montant_nouveau,motif) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [t.id, annee, niveau, t.libelle, 'scolarite', prev.montant, montant, 'augmentation_auto']);
    crees.push(t);
  }
  done.add(key);
  return crees;
}
module.exports = { AUGMENTATION, assurerTarifsAnnee, historiser };

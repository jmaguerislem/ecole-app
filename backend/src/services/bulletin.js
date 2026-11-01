const { q } = require('../db');
const config = require('../config');

const appreciation = (m) => (m === null ? '—' : m >= 16 ? 'Excellent travail' : m >= 14 ? 'Très bien' : m >= 12 ? 'Bien' : m >= 10 ? 'Passable' : 'Insuffisant : efforts à fournir');
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

async function computeBulletin(eleveId, trimestre = null, annee = config.anneeCourante) {
  const el = (await q(
    `SELECT e.*, c.niveau||COALESCE(' '||c.section,'') AS classe_nom, c.id AS cid, u.nom||' '||u.prenom AS titulaire
     FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id LEFT JOIN users u ON u.id=c.titulaire_id WHERE e.id=$1 AND e.deleted_at IS NULL`, [eleveId])).rows[0];
  if (!el) return null;
  const tri = trimestre ? Number(trimestre) : null;
  const matieres = (await q(
    `SELECT m.id matiere_id, m.nom, m.coefficient, AVG(n.valeur/ev.bareme*20) AS moyenne, COUNT(n.id) AS nb_notes
     FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.deleted_at IS NULL JOIN matieres m ON m.id=ev.matiere_id
     WHERE n.eleve_id=$1 AND n.deleted_at IS NULL AND ev.annee_scolaire=$2 AND ($3::int IS NULL OR ev.trimestre=$3)
     GROUP BY m.id ORDER BY m.nom`, [eleveId, annee, tri])).rows.map((m) => ({ ...m, moyenne: r2(m.moyenne) }));
  const gen = (list) => { const s = list.reduce((a, m) => a + m.coefficient, 0); return s ? list.reduce((a, m) => a + m.moyenne * m.coefficient, 0) / s : null; };
  const moyenne_generale = r2(gen(matieres));

  // Classement dans la classe
  let rang = null, effectif = 0, moyenne_classe = null;
  if (el.cid) {
    const all = (await q(
      `WITH per AS (
         SELECT n.eleve_id, m.coefficient coef, AVG(n.valeur/ev.bareme*20) moy
         FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.deleted_at IS NULL JOIN matieres m ON m.id=ev.matiere_id
         JOIN eleves e ON e.id=n.eleve_id AND e.classe_id=$1 AND e.deleted_at IS NULL
         WHERE n.deleted_at IS NULL AND ev.annee_scolaire=$2 AND ($3::int IS NULL OR ev.trimestre=$3)
         GROUP BY n.eleve_id, m.id, m.coefficient)
       SELECT eleve_id, SUM(moy*coef)/NULLIF(SUM(coef),0) AS moyenne FROM per GROUP BY eleve_id`, [el.cid, annee, tri])).rows;
    effectif = all.length;
    if (moyenne_generale !== null && effectif) {
      rang = 1 + all.filter((x) => r2(x.moyenne) > moyenne_generale).length;
      moyenne_classe = r2(all.reduce((a, x) => a + x.moyenne, 0) / effectif);
    }
  }
  const abs = (await q(
    `SELECT COUNT(*) FILTER (WHERE justifiee) AS justifiees, COUNT(*) FILTER (WHERE NOT justifiee) AS non_justifiees
     FROM absences WHERE eleve_id=$1 AND annee_scolaire=$2 AND deleted_at IS NULL`, [eleveId, annee])).rows[0];
  return {
    eleve: { id: el.id, nom: el.nom, prenom: el.prenom, matricule: el.matricule, date_naissance: el.date_naissance },
    classe: el.classe_nom, titulaire: el.titulaire, annee_scolaire: annee, trimestre: tri,
    matieres, moyenne_generale, moyenne_classe, rang, effectif, absences: abs, appreciation: appreciation(moyenne_generale),
  };
}
module.exports = { computeBulletin };

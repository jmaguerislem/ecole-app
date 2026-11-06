// Complète l'école d'origine (« École Primaire Abou Kacem Chebbi ») avec des données cohérentes, au même niveau que les autres écoles :
//   6 classes (1ère → 6ème année) avec leur titulaire, 6 enseignants, matières, salles, affectations, emploi du temps,
//   4 élèves par classe (chacun avec son COMPTE DE CONNEXION, mot de passe haché), familles, paiements, évaluations/notes, absences, devoir, annonce.
// Sans danger : n'ajoute que ce qui manque, ne modifie ni ne supprime aucune donnée existante, et peut être relancé (rien n'est dupliqué).
//   npm run ecoles:completer          (déjà appelé par `npm run seed:ecoles`)
// Les quotas de la formule Basic (50 élèves, 20 utilisateurs hors comptes élèves) sont respectés.
const bcrypt = require('bcryptjs');
const { tx, qa, runWith, end } = require('../db');
const config = require('../config');
const { genererEmailEleve } = require('../services/emailEleve');
const D = require('../seed-ecoles');

const SLUG = 'ecole-primaire-abou-kacem-chebbi';
const PAR_CLASSE = 4;
const NB_PARENTS = 10; // parent1 et parent2 existent déjà ; 8 familles sont ajoutées

async function completerEcoleOrigine({ hash } = {}) {
  const school = (await qa('SELECT id, nom, ville FROM schools WHERE slug=$1', [SLUG])).rows[0];
  if (!school) { console.log("[completer] École d'origine introuvable : rien à faire."); return null; }
  const pw = hash || await bcrypt.hash(D.PW, 10);
  const A = config.anneeCourante; const START = Number(A.slice(0, 4));
  const ville = school.ville || 'Tozeur';
  const store = { schoolId: school.id, schoolNom: school.nom };
  const bilan = { enseignants: 0, parents: 0, classes: 0, eleves: 0, comptes: 0, paiements: 0 };

  await runWith(store, () => tx(async (cl) => {
    const one = async (sql, p) => (await cl.query(sql, p)).rows[0];
    const user = async (email, role, nom, prenom, tel, spec) => {
      const ex = await one('SELECT id FROM users WHERE email=$1', [email]);
      if (ex) return { id: ex.id, neuf: false };
      const u = await one('INSERT INTO users(email,password_hash,role,nom,prenom,telephone,specialite) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [email, pw, role, nom, prenom, tel || null, spec || null]);
      return { id: u.id, neuf: true };
    };
    const compta = (await one("SELECT id FROM users WHERE role='comptable' AND deleted_at IS NULL ORDER BY id LIMIT 1")).id;
    const direction = (await one("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY id LIMIT 1")).id;

    // --- Enseignants : ens1 et ens2 existent ; ens3 → ens6 pour les 4 autres niveaux
    const ens = [];
    for (let k = 0; k < 6; k++) {
      const ex = await one('SELECT id FROM users WHERE email=$1', [`ens${k + 1}@ecole.tn`]);
      if (ex) { ens.push(ex.id); continue; }
      const r = await user(`ens${k + 1}@ecole.tn`, 'enseignant', D.ENS_NOMS[(k * 3 + 5) % 30], D.ENS_PRENOMS[(k * 5 + 3) % 30], D.tel(300 + k), `Instituteur ${D.NIVEAUX[k]}`);
      ens.push(r.id); bilan.enseignants++;
    }

    // --- Classes (année courante)
    const classes = [];
    for (let k = 0; k < 6; k++) {
      let c = await one("SELECT id FROM classes WHERE niveau=$1 AND COALESCE(section,'')='A' AND annee_scolaire=$2 AND deleted_at IS NULL", [D.NIVEAUX[k], A]);
      if (!c) { c = await one('INSERT INTO classes(niveau,section,capacite,titulaire_id,annee_scolaire) VALUES ($1,$2,25,$3,$4) RETURNING id', [D.NIVEAUX[k], 'A', ens[k], A]); bilan.classes++; }
      classes.push(c.id);
    }

    // --- Matières, salles
    const mat = {};
    for (const [nom, coef] of D.MATIERES) {
      const m = await one('SELECT id FROM matieres WHERE lower(nom)=lower($1) AND deleted_at IS NULL ORDER BY id LIMIT 1', [nom])
        || await one('INSERT INTO matieres(nom,coefficient) VALUES ($1,$2) RETURNING id', [nom, coef]);
      mat[nom] = m.id;
    }
    const salles = [];
    for (let k = 1; k <= 6; k++) {
      const s = await one('SELECT id FROM salles WHERE lower(nom)=lower($1) AND deleted_at IS NULL', [`Salle ${k}`])
        || await one('INSERT INTO salles(nom,capacite) VALUES ($1,25) RETURNING id', [`Salle ${k}`]);
      salles.push(s.id);
    }
    if (!(await one("SELECT id FROM salles WHERE lower(nom)='salle informatique' AND deleted_at IS NULL"))) await cl.query("INSERT INTO salles(nom,capacite) VALUES ('Salle informatique',20)");

    // --- Affectations (chaque titulaire enseigne toutes les matières dans sa classe) et emploi du temps des classes qui n'en ont pas
    const H = [[1, '08:00', '09:00', 'Arabe'], [1, '09:15', '10:15', 'Français'], [1, '10:30', '11:30', 'Mathématiques'], [2, '08:00', '09:00', 'Mathématiques'], [2, '09:15', '10:15', 'Éveil scientifique'], [2, '10:30', '11:30', 'Éducation islamique']];
    for (let k = 0; k < 6; k++) {
      for (const m of Object.values(mat)) {
        if (!(await one('SELECT 1 AS x FROM affectations WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire=$4 AND deleted_at IS NULL', [ens[k], m, classes[k], A])))
          await cl.query('INSERT INTO affectations(enseignant_id,matiere_id,classe_id,annee_scolaire) VALUES ($1,$2,$3,$4)', [ens[k], m, classes[k], A]);
      }
      if (!(await one('SELECT 1 AS x FROM creneaux WHERE classe_id=$1 AND deleted_at IS NULL', [classes[k]])))
        for (const [j, d, f, nom] of H) await cl.query('INSERT INTO creneaux(classe_id,matiere_id,enseignant_id,salle_id,jour,heure_debut,heure_fin,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [classes[k], mat[nom], ens[k], salles[k], j, d, f, A]);
    }

    // --- Parents : parent1, parent2 existent ; parent3 → parent10 ajoutés
    const parents = [];
    for (let f = 0; f < NB_PARENTS; f++) {
      const ex = await one('SELECT id, nom, prenom FROM users WHERE email=$1', [`parent${f + 1}@mail.tn`]);
      if (ex) { parents.push({ id: ex.id, nom: ex.nom, prenom: ex.prenom }); continue; }
      const nom = D.FAMILLES[(f * 7 + 3) % 30]; const [prenom] = D.ADULTES[(f * 5 + 2) % 30];
      const r = await user(`parent${f + 1}@mail.tn`, 'parent', nom, prenom, D.tel(700 + f));
      await cl.query('UPDATE users SET consentement_rgpd_at=now() WHERE id=$1', [r.id]);
      parents.push({ id: r.id, nom, prenom }); bilan.parents++;
    }

    // --- Élèves : jusqu'à PAR_CLASSE par classe, chacun avec son compte de connexion (e-mail de l'élève, mot de passe haché)
    const effectif = async (cid) => Number((await one('SELECT COUNT(*) n FROM eleves WHERE classe_id=$1 AND deleted_at IS NULL', [cid])).n);
    const tIns = await one("SELECT id FROM tarifs WHERE type='inscription' AND annee_scolaire=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1", [A]);
    const tSco = (await cl.query("SELECT id, niveau, montant FROM tarifs WHERE type='scolarite' AND annee_scolaire=$1 AND deleted_at IS NULL", [A])).rows;
    const nouveaux = []; let n = 0;
    for (let k = 0; k < 6; k++) {
      for (let i = await effectif(classes[k]); i < PAR_CLASSE; i++, n++) {
        const p = parents[(n * 3 + k) % parents.length];
        const sexe = n % 2 ? 'F' : 'M'; const prenom = (sexe === 'M' ? D.GARCONS : D.FILLES)[(n * 3 + 7) % 40];
        const naiss = `${START - 6 - k}-${D.pad(1 + ((n * 5 + 3) % 12))}-${D.pad(1 + ((n * 7 + 2) % 28))}`;
        const email = await genererEmailEleve({ nom: p.nom, prenom, date_naissance: naiss, schoolId: school.id });
        const compte = await user(email, 'eleve', p.nom, prenom);
        if (compte.neuf) bilan.comptes++;
        const el = await one(
          'INSERT INTO eleves(nom,prenom,date_naissance,sexe,adresse,annee_entree,classe_id,user_id,email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [p.nom, prenom, naiss, sexe, `${1 + ((n * 3) % 60)} ${D.RUES[(n + k) % 10]}, ${ville}`, `${START - k}-${START - k + 1}`, classes[k], compte.id, email]);
        await cl.query('UPDATE eleves SET matricule=$1 WHERE id=$2', [`E${START - k}${D.pad(el.id, 4)}`, el.id]);
        await cl.query('INSERT INTO eleve_parents(eleve_id,parent_id,lien) VALUES ($1,$2,$3)', [el.id, p.id, n % 3 === 0 ? 'Mère' : 'Père']);
        nouveaux.push({ id: el.id, k, n }); bilan.eleves++;
      }
    }

    // --- Paiements des nouveaux élèves : inscription pour tous, scolarité (totale ou première tranche) pour une partie
    const pay = async (el, tarif, montant, mode, jour) => {
      const x = await one('INSERT INTO paiements(eleve_id,tarif_id,montant,mode,date_paiement,annee_scolaire,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [el.id, tarif, montant, mode, `${START}-09-${D.pad(jour)}`, A, compta]);
      await cl.query('UPDATE paiements SET numero_recu=$1 WHERE id=$2', [`REC-${START}-${D.pad(x.id, 5)}`, x.id]); bilan.paiements++;
    };
    for (const el of nouveaux) {
      if (tIns) await pay(el, tIns.id, 100, 'especes', 5 + (el.n % 10));
      const t = tSco.find((x) => x.niveau === D.NIVEAUX[el.k]);
      if (t && el.n % 5 === 0) await pay(el, t.id, t.montant, 'mobile_money', 12 + (el.n % 10));
      else if (t && el.n % 3 === 0) await pay(el, t.id, 300, 'virement', 15 + (el.n % 10));
    }

    // --- Évaluations et notes (trimestre 1) pour les classes qui n'en ont pas, absences, devoir, annonce
    for (let k = 0; k < 6; k++) {
      if (await one('SELECT 1 AS x FROM evaluations WHERE classe_id=$1 AND deleted_at IS NULL', [classes[k]])) continue;
      const eleves = (await cl.query('SELECT id FROM eleves WHERE classe_id=$1 AND deleted_at IS NULL ORDER BY id', [classes[k]])).rows;
      for (const [i, [titre, nom]] of [['Dictée 1', 'Français'], ['Contrôle de calcul', 'Mathématiques']].entries()) {
        const ev = await one('INSERT INTO evaluations(classe_id,matiere_id,titre,trimestre,date_eval,bareme,annee_scolaire,created_by) VALUES ($1,$2,$3,1,$4,20,$5,$6) RETURNING id', [classes[k], mat[nom], titre, `${START}-10-${D.pad(10 + i * 7)}`, A, ens[k]]);
        for (const [j, e] of eleves.entries()) await cl.query('INSERT INTO notes(evaluation_id,eleve_id,valeur,annee_scolaire) VALUES ($1,$2,$3,$4)', [ev.id, e.id, 8 + ((j * 7 + i * 5 + k * 3) % 12), A]);
      }
    }
    if (nouveaux.length >= 2) {
      const [a1, a2] = [nouveaux[0], nouveaux[nouveaux.length - 1]];
      if (!(await one('SELECT 1 AS x FROM absences WHERE eleve_id=ANY($1::int[])', [[a1.id, a2.id]]))) {
        await cl.query("INSERT INTO absences(eleve_id,date_absence,periode,motif,annee_scolaire) VALUES ($1,$2,'journee','Maladie',$3)", [a1.id, `${START}-10-08`, A]);
        await cl.query("INSERT INTO absences(eleve_id,date_absence,periode,motif,justifiee,justification,annee_scolaire) VALUES ($1,$2,'matin','Rendez-vous médical',TRUE,'Certificat médical présenté à la direction',$3)", [a2.id, `${START}-10-15`, A]);
      }
    }
    if (!(await one('SELECT 1 AS x FROM devoirs WHERE classe_id=$1 AND deleted_at IS NULL', [classes[2]])))
      await cl.query("INSERT INTO devoirs(titre,description,matiere_id,classe_id,enseignant_id,date_remise,annee_scolaire) VALUES ('Exercices de calcul','Résoudre les exercices 1 à 5 de la page 12.',$1,$2,$3, now() + interval '5 days',$4)", [mat['Mathématiques'], classes[2], ens[2], A]);
    if (!(await one("SELECT 1 AS x FROM annonces WHERE titre='Réunion parents-enseignants'")))
      await cl.query("INSERT INTO annonces(auteur_id,titre,corps,audience) VALUES ($1,$2,$3,'parents')", [direction, 'Réunion parents-enseignants', 'Une réunion avec les enseignants aura lieu le premier samedi du mois à 10h00 dans la salle polyvalente.']);
  }));
  console.log(`[completer] ${school.nom} : +${bilan.enseignants} enseignant(s), +${bilan.parents} parent(s), +${bilan.classes} classe(s), +${bilan.eleves} élève(s) (${bilan.comptes} compte(s) de connexion), +${bilan.paiements} paiement(s).`);
  return bilan;
}

module.exports = { completerEcoleOrigine };
if (require.main === module) {
  require('../migrate')().then(() => completerEcoleOrigine()).catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => end());
}

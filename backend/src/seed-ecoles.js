// Crée 5 écoles de démonstration complètes et cohérentes : npm run seed:ecoles
//  • par école : direction, secrétariat/comptabilité, 6 enseignants (un par niveau), 18 parents, 30 élèves (6 classes × 5),
//    matières, affectations, emploi du temps, tarifs par niveau (avec historique), paiements, évaluations/notes, absences, annonces ;
//  • sans doublon : une école déjà présente (même identifiant) est ignorée ; les e-mails sont uniques dans toute la base ;
//  • en cas d'erreur, l'école en cours est entièrement retirée (jamais de données à moitié créées).
// Les comptes sont listés dans la console et dans docs/COMPTES_DEMO.md.
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { tx, qa, runWith, end } = require('./db');
const migrate = require('./migrate');
const config = require('./config');
const { genererEmailEleve } = require('./services/emailEleve');
const { assurerTarifsAnnee, historiser } = require('./services/tarifs');

const PW = process.env.SEED_PASSWORD || 'Demo@2026!';
const A = config.anneeCourante; const START = Number(A.slice(0, 4)); const PREV = `${START - 1}-${START}`;
const NIVEAUX = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année'];
const MATIERES = [['Arabe', 3], ['Français', 3], ['Mathématiques', 3], ['Éveil scientifique', 1.5], ['Éducation islamique', 1]];
const pad = (n, l = 2) => String(n).padStart(l, '0');

const ECOLES = [
  { slug: 'habib-bourguiba', nom: 'École Primaire Habib Bourguiba', ville: 'Tunis', adresse: '12 avenue de la République, 1001 Tunis', tel: '71 245 300', plan: 'standard', status: 'active', base: 600,
    dir: ['Ben Romdhane', 'Mongi'], compta: ['Ben Ali', 'Sonia'] },
  { slug: 'ibn-khaldoun', nom: 'École Primaire Ibn Khaldoun', ville: 'Sfax', adresse: '45 rue de la Liberté, 3000 Sfax', tel: '74 221 118', plan: 'standard', status: 'active', base: 550,
    dir: ['Chakroun', 'Lamia'], compta: ['Mhiri', 'Sami'] },
  { slug: 'les-oliviers', nom: 'École Primaire Les Oliviers', ville: 'Sousse', adresse: '8 boulevard du 14 Janvier, 4000 Sousse', tel: '73 226 740', plan: 'premium', status: 'active', base: 650,
    dir: ['Bouzid', 'Nejib'], compta: ['Garbouj', 'Houda'] },
  { slug: 'abou-el-kacem', nom: 'École Primaire Abou el Kacem Chebbi – Nabeul', ville: 'Nabeul', adresse: '27 avenue Farhat Hached, 8000 Nabeul', tel: '72 285 402', plan: 'standard', status: 'active', base: 575,
    dir: ['Elloumi', 'Ridha'], compta: ['Bellagha', 'Najla'] },
  { slug: 'la-jawhara', nom: 'École Primaire La Jawhara', ville: 'Bizerte', adresse: '3 rue de la Corniche, 7000 Bizerte', tel: '72 431 559', plan: 'standard', status: 'trial', base: 525,
    dir: ['Haouari', 'Samira'], compta: ['Khlif', 'Marouen'] },
];
// Noms (jeux assez grands pour que les combinaisons ne se répètent pas d'une école à l'autre)
const FAMILLES = ['Ben Salah', 'Trabelsi', 'Gharbi', 'Mejri', 'Jlassi', 'Hamdi', 'Saidi', 'Bouazizi', 'Chaouch', 'Mansouri', 'Khelifi', 'Zouari', 'Dridi', 'Ayari', 'Karoui', 'Maaloul', 'Ben Ammar', 'Ben Youssef', 'Hammami', 'Belhadj', 'Lahmar', 'Cherif', 'Slimani', 'Rezgui', 'Bouslama', 'Triki', 'Ferchichi', 'Nasri', 'Haddad', 'Jebali'];
const ADULTES = [['Hatem', 'M'], ['Amel', 'F'], ['Mourad', 'M'], ['Rim', 'F'], ['Walid', 'M'], ['Ines', 'F'], ['Anis', 'M'], ['Leila', 'F'], ['Fares', 'M'], ['Mouna', 'F'], ['Slim', 'M'], ['Hela', 'F'], ['Nabil', 'M'], ['Sarra', 'F'], ['Rached', 'M'], ['Dorra', 'F'], ['Hichem', 'M'], ['Olfa', 'F'], ['Tarek', 'M'], ['Samia', 'F'], ['Moez', 'M'], ['Nadia', 'F'], ['Lotfi', 'M'], ['Wafa', 'F'], ['Adel', 'M'], ['Hanen', 'F'], ['Riadh', 'M'], ['Imen', 'F'], ['Zied', 'M'], ['Rania', 'F']];
const GARCONS = ['Yassine', 'Omar', 'Adam', 'Aymen', 'Mohamed', 'Youssef', 'Ahmed', 'Karim', 'Amine', 'Khalil', 'Ali', 'Hamza', 'Iyed', 'Skander', 'Rayan', 'Bilel', 'Seif', 'Wassim', 'Mehdi', 'Fedi', 'Oussama', 'Ghaith', 'Zakaria', 'Anas', 'Bechir', 'Hedi', 'Malek', 'Nizar', 'Rami', 'Taha', 'Yacine', 'Zine', 'Marwen', 'Ilyes', 'Louay', 'Eya-Allah', 'Sofien', 'Haythem', 'Jawher', 'Mootez'];
const FILLES = ['Salma', 'Nour', 'Aya', 'Yasmine', 'Mariem', 'Lina', 'Sirine', 'Eya', 'Rahma', 'Ons', 'Farah', 'Malak', 'Syrine', 'Ghofrane', 'Cyrine', 'Amira', 'Dhikra', 'Emna', 'Hiba', 'Jihen', 'Khouloud', 'Lamis', 'Mayssa', 'Nesrine', 'Oumaima', 'Racha', 'Sabrine', 'Takwa', 'Wiem', 'Yosra', 'Zeineb', 'Asma', 'Balkis', 'Chaima', 'Doua', 'Fatma', 'Ghada', 'Hajer', 'Israa', 'Molka'];
const ENS_NOMS = ['Ben Mahmoud', 'Gharsallah', 'Kefi', 'Tlili', 'Ouerghi', 'Msakni', 'Bahri', 'Jaziri', 'Mabrouk', 'Zaouali', 'Abidi', 'Chebbi', 'Dhaouadi', 'Essid', 'Fourati', 'Guesmi', 'Hajji', 'Ismail', 'Kacem', 'Louati', 'Marzouki', 'Neji', 'Omrani', 'Rekik', 'Sassi', 'Tounsi', 'Yahyaoui', 'Zarrouk', 'Aouadi', 'Brahmi'];
const ENS_PRENOMS = ['Karim', 'Leila', 'Sofiane', 'Naziha', 'Habib', 'Salwa', 'Faouzi', 'Rabiaa', 'Chokri', 'Dalila', 'Maher', 'Ibtissem', 'Jalel', 'Monia', 'Lassaad', 'Zohra', 'Bassem', 'Thouraya', 'Hafedh', 'Souad', 'Kamel', 'Nawel', 'Anouar', 'Radhia', 'Foued', 'Hayet', 'Mounir', 'Latifa', 'Sadok', 'Awatef'];
const RUES = ['rue Ibn Sina', 'avenue de Carthage', 'rue Ali Belhouane', 'rue de Palestine', 'avenue Mohamed V', 'rue Hédi Chaker', 'rue des Jasmins', 'avenue de l’Indépendance', 'rue Moncef Bey', 'rue El Houria'];
const tel = (g) => `${[2, 5, 9][g % 3]}${pad((1000000 + g * 7919) % 9000000 + 1000000, 7).slice(0, 7)}`;

async function purger(schoolId) { // retire toute trace d'une école (utilisé seulement si la création échoue)
  const tables = (await qa("SELECT table_name FROM information_schema.columns WHERE column_name='school_id' AND table_schema='public' AND table_name<>'schools'")).rows.map((r) => r.table_name);
  for (let pass = 0; pass < 8; pass++) for (const t of tables) await qa(`DELETE FROM ${t} WHERE school_id=$1`, [schoolId]).catch(() => {});
  await qa('DELETE FROM schools WHERE id=$1', [schoolId]).catch(() => {});
}

async function creerEcole(e, i, hash) {
  const fin = new Date(); fin.setUTCDate(fin.getUTCDate() + (e.status === 'trial' ? 30 : 365));
  const school = (await qa(`INSERT INTO schools(nom,slug,status,plan,subscription_end,ville,adresse,telephone,email_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [e.nom, e.slug, e.status, e.plan, fin.toISOString().slice(0, 10), e.ville, e.adresse, e.tel, `contact@${e.slug}.tn`])).rows[0];
  const store = { schoolId: school.id, schoolNom: school.nom };
  const dom = `@${e.slug}.tn`;
  const ids = { ens: [], classes: [], eleves: [], parents: [], tarifIns: null };
  try {
    await runWith(store, () => tx(async (cl) => {
      const X = async (sql, p) => (await cl.query(sql, p)).rows[0];
      const user = (email, role, nom, prenom, tel_, spec) => X('INSERT INTO users(email,password_hash,role,nom,prenom,telephone,specialite) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [email, hash, role, nom, prenom, tel_ || null, spec || null]).then((r) => r.id);
      // Administration
      const direction = await user(`directeur${dom}`, 'admin', e.dir[0], e.dir[1], tel(i * 3));
      const compta = await user(`compta${dom}`, 'comptable', e.compta[0], e.compta[1], tel(i * 3 + 1));
      // Enseignants : un titulaire par niveau
      for (let k = 0; k < 6; k++) { const t = i * 6 + k; ids.ens.push(await user(`ens${k + 1}${dom}`, 'enseignant', ENS_NOMS[t % 30], ENS_PRENOMS[(t * 7) % 30], tel(100 + t), `Instituteur ${NIVEAUX[k]}`)); }
      // Classes, matières, salles, affectations, emploi du temps
      for (let k = 0; k < 6; k++) ids.classes.push((await X('INSERT INTO classes(niveau,section,capacite,titulaire_id,annee_scolaire) VALUES ($1,$2,25,$3,$4) RETURNING id', [NIVEAUX[k], 'A', ids.ens[k], A])).id);
      const mat = []; for (const [n, c] of MATIERES) mat.push((await X('INSERT INTO matieres(nom,coefficient) VALUES ($1,$2) RETURNING id', [n, c])).id);
      const salles = []; for (let k = 1; k <= 6; k++) salles.push((await X('INSERT INTO salles(nom,capacite) VALUES ($1,25) RETURNING id', [`Salle ${k}`])).id);
      await X("INSERT INTO salles(nom,capacite) VALUES ('Salle informatique',20) RETURNING id");
      const H = [[1, '08:00', '09:00', 0], [1, '09:15', '10:15', 1], [1, '10:30', '11:30', 2], [2, '08:00', '09:00', 2], [2, '09:15', '10:15', 3], [2, '10:30', '11:30', 4]];
      for (let k = 0; k < 6; k++) {
        for (const m of mat) await cl.query('INSERT INTO affectations(enseignant_id,matiere_id,classe_id,annee_scolaire) VALUES ($1,$2,$3,$4)', [ids.ens[k], m, ids.classes[k], A]);
        for (const [j, d, f, mi] of H) await cl.query('INSERT INTO creneaux(classe_id,matiere_id,enseignant_id,salle_id,jour,heure_debut,heure_fin,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [ids.classes[k], mat[mi], ids.ens[k], salles[k], j, d, f, A]);
      }
      // Familles : 12 familles de 2 enfants (classes différentes) + 6 familles d'1 enfant = 18 parents, 30 élèves
      const slots = []; // slot s -> classe s%6
      const famille = []; // slot -> index de famille
      for (let f = 0; f < 12; f++) { famille[f] = f; famille[f + 13] = f; }
      [12, 25, 26, 27, 28, 29].forEach((s, n) => { famille[s] = 12 + n; });
      for (let f = 0; f < 18; f++) {
        const g = i * 18 + f; const [pren, sexe] = ADULTES[(g * 7 + Math.floor(g / 30)) % 30];
        ids.parents.push({ id: await user(`parent${f + 1}${dom}`, 'parent', FAMILLES[g % 30], pren, tel(500 + g)), sexe, nom: FAMILLES[g % 30] });
      }
      for (let s = 0; s < 30; s++) {
        const k = s % 6; const fam = ids.parents[famille[s]]; const g = i * 18 + famille[s];
        const sexe = s % 2 ? 'F' : 'M'; const prenom = (sexe === 'M' ? GARCONS : FILLES)[(s * 3 + i * 5) % 40];
        const naiss = `${START - 6 - k}-${pad(1 + ((s * 5 + i) % 12))}-${pad(1 + ((s * 7 + i) % 28))}`;
        const email = await genererEmailEleve({ nom: fam.nom, prenom, date_naissance: naiss, schoolId: school.id });
        const compteEleve = s === 0 ? await user(`eleve1${dom}`, 'eleve', fam.nom, prenom) : null;
        const el = await X('INSERT INTO eleves(nom,prenom,date_naissance,sexe,adresse,antecedents_medicaux,annee_entree,classe_id,user_id,email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [fam.nom, prenom, naiss, sexe, `${1 + ((s * 3 + g) % 60)} ${RUES[(s + i) % 10]}, ${e.ville}`, s % 11 === 5 ? 'Asthme léger – inhalateur en classe' : null, `${START - k}-${START - k + 1}`, ids.classes[k], compteEleve, email]);
        await cl.query('UPDATE eleves SET matricule=$1 WHERE id=$2', [`E${START - k}${pad(el.id, 4)}`, el.id]);
        await cl.query('INSERT INTO eleve_parents(eleve_id,parent_id,lien) VALUES ($1,$2,$3)', [el.id, fam.id, fam.sexe === 'M' ? 'Père' : 'Mère']);
        ids.eleves.push({ id: el.id, k, s });
      }
      // Tarifs de l'année précédente (la hausse de +50 DT de l'année courante est ensuite générée par l'application elle-même)
      const addTarif = async (an, lib, type, niveau, montant) => {
        const t = await X('INSERT INTO tarifs(annee_scolaire,libelle,type,niveau,montant) VALUES ($1,$2,$3,$4,$5) RETURNING *', [an, lib, type, niveau, montant]);
        await historiser(cl, { tarif: t, nouveau: montant, motif: 'creation', userId: direction });
        return t;
      };
      await addTarif(PREV, "Frais d'inscription", 'inscription', null, 100);
      ids.tarifIns = await addTarif(A, "Frais d'inscription", 'inscription', null, 100);
      for (let k = 0; k < 6; k++) await addTarif(PREV, `Scolarité – ${NIVEAUX[k]}`, 'scolarite', NIVEAUX[k], e.base + 50 * k - 50);
      // Évaluations et notes (trimestre 1)
      for (let k = 0; k < 6; k++) for (const [n, [titre, mi]] of [['Dictée 1', 1], ['Contrôle de calcul', 2]].map((x, n) => [n, x])) {
        const ev = await X("INSERT INTO evaluations(classe_id,matiere_id,titre,trimestre,date_eval,bareme,annee_scolaire,created_by) VALUES ($1,$2,$3,1,$4,20,$5,$6) RETURNING id", [ids.classes[k], mat[mi], titre, `${START}-10-${pad(10 + n * 7)}`, A, ids.ens[k]]);
        for (const el of ids.eleves.filter((x) => x.k === k)) await cl.query('INSERT INTO notes(evaluation_id,eleve_id,valeur,annee_scolaire) VALUES ($1,$2,$3,$4)', [ev.id, el.id, 8 + ((el.s * 7 + n * 5 + i * 3) % 12), A]);
      }
      // Absences (dont une justifiée) et devoirs
      const a1 = ids.eleves[3]; const a2 = ids.eleves[8];
      await cl.query("INSERT INTO absences(eleve_id,date_absence,periode,motif,annee_scolaire) VALUES ($1,$2,'journee','Maladie',$3)", [a1.id, `${START}-10-08`, A]);
      await cl.query("INSERT INTO absences(eleve_id,date_absence,periode,motif,justifiee,justification,annee_scolaire) VALUES ($1,$2,'matin','Rendez-vous médical',TRUE,'Certificat médical présenté à la direction',$3)", [a2.id, `${START}-10-15`, A]);
      await cl.query("INSERT INTO devoirs(titre,description,matiere_id,classe_id,enseignant_id,date_remise,annee_scolaire) VALUES ('Exercices de calcul','Résoudre les exercices 1 à 5 de la page 12.',$1,$2,$3, now() + interval '5 days',$4)", [mat[2], ids.classes[0], ids.ens[0], A]);
      // Annonces de la direction
      await cl.query("INSERT INTO annonces(auteur_id,titre,corps,audience) VALUES ($1,$2,$3,'tous')", [direction, 'Rentrée scolaire', `Bienvenue à l'${e.nom} pour l'année ${A}. Les cours ont lieu de 8h00 à 16h00.`]);
      await cl.query("INSERT INTO annonces(auteur_id,titre,corps,audience) VALUES ($1,$2,$3,'parents')", [direction, 'Réunion parents-enseignants', 'Une réunion avec les enseignants aura lieu le premier samedi du mois à 10h00 dans la salle polyvalente.']);
      ids.compta = compta;
    }));
    // +50 DT par niveau pour l'année courante : généré par la règle de l'application (et historisé)
    await runWith(store, () => assurerTarifsAnnee(A, { force: true }));
    // Paiements : inscription pour tous, tranche ou totalité de la scolarité pour une partie des élèves
    await runWith(store, () => tx(async (cl) => {
      const sc = (await cl.query("SELECT id, niveau, montant FROM tarifs WHERE type='scolarite' AND annee_scolaire=$1", [A])).rows;
      if (sc.length !== 6) throw new Error(`Tarifs de scolarité attendus : 6, obtenus : ${sc.length}`);
      const pay = async (el, tarif, montant, mode, jour) => {
        const p = (await cl.query('INSERT INTO paiements(eleve_id,tarif_id,montant,mode,date_paiement,annee_scolaire,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [el.id, tarif, montant, mode, `${START}-09-${pad(jour)}`, A, ids.compta])).rows[0];
        await cl.query('UPDATE paiements SET numero_recu=$1 WHERE id=$2', [`REC-${START}-${pad(p.id, 5)}`, p.id]);
      };
      for (const el of ids.eleves) {
        await pay(el, ids.tarifIns.id, 100, 'especes', 5 + (el.s % 10));
        const t = sc.find((x) => x.niveau === NIVEAUX[el.k]);
        if (el.s % 5 === 0) await pay(el, t.id, t.montant, 'mobile_money', 12 + (el.s % 10)); // scolarité réglée en totalité
        else if (el.s % 3 === 0) await pay(el, t.id, 300, 'virement', 15 + (el.s % 10)); // première tranche
      }
    }));
  } catch (err) { await purger(school.id); throw err; }
  return school;
}

async function documenter(hash) {
  const L = [`# Comptes de démonstration – 6 écoles`, '', `Mot de passe de **tous** les comptes : \`${PW}\`  ·  Année scolaire : ${A}`, '', 'Créés par `npm run seed:ecoles` (Docker : `docker compose exec app node src/seed-ecoles.js`). **Ne pas utiliser en production.**', ''];
  L.push('## Plateforme', '', '| Rôle | E-mail | Accès |', '|---|---|---|', '| Super-administrateur | `super@ecole.tn` | Page « Écoles » : liste, formules, abonnements |', '');
  for (const e of [{ slug: 'ecole-primaire-abou-kacem-chebbi' }, ...ECOLES]) {
    const s = (await qa('SELECT * FROM schools WHERE slug=$1', [e.slug])).rows[0]; if (!s) continue;
    const users = (await qa('SELECT id,email,role,nom,prenom,telephone,specialite FROM users WHERE school_id=$1 AND deleted_at IS NULL ORDER BY role, email', [s.id])).rows;
    const par = async (id) => (await qa("SELECT e.prenom||' '||e.nom AS n, COALESCE(c.niveau||' '||c.section,'') AS c FROM eleve_parents ep JOIN eleves e ON e.id=ep.eleve_id LEFT JOIN classes c ON c.id=e.classe_id WHERE ep.parent_id=$1 ORDER BY e.id", [id])).rows.map((r) => `${r.n} (${r.c})`).join(', ');
    const cnt = (await qa('SELECT (SELECT COUNT(*) FROM eleves WHERE school_id=$1) el, (SELECT COUNT(*) FROM classes WHERE school_id=$1) cl', [s.id])).rows[0];
    L.push(`## ${s.nom}`, '', `${s.adresse} · Tél. ${s.telephone} · ${s.email_contact} · formule **${s.plan}** · statut **${s.status}** · ${cnt.el} élèves, ${cnt.cl} classes · lien de pré-inscription : \`/preinscription/${s.slug}\``, '');
    L.push('| Rôle | E-mail | Nom | Détail |', '|---|---|---|---|');
    const R = { admin: 'Directeur / Directrice', comptable: 'Secrétariat / Comptabilité', enseignant: 'Enseignant', parent: 'Parent', eleve: 'Élève' };
    for (const role of ['admin', 'comptable', 'enseignant', 'parent', 'eleve']) for (const u of users.filter((x) => x.role === role)) {
      let d = '';
      if (role === 'enseignant') d = u.specialite; else if (role === 'parent') d = `Enfant(s) : ${await par(u.id)}`;
      else if (role === 'eleve') d = (await qa("SELECT e.prenom||' '||e.nom||' – '||COALESCE(c.niveau||' '||c.section,'') AS n FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.user_id=$1", [u.id])).rows[0]?.n || '';
      L.push(`| ${R[role]} | \`${u.email}\` | ${u.prenom} ${u.nom} | ${d} |`);
    }
    L.push('');
  }
  const txt = L.join('\n');
  try { const f = path.join(__dirname, '..', '..', 'docs', 'COMPTES_DEMO.md'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); console.log(`[seed-ecoles] Liste des comptes écrite dans ${path.relative(process.cwd(), f)}`); }
  catch { console.log('[seed-ecoles] (docs/ non accessible : liste affichée ci-dessous seulement)'); }
  return txt;
}

async function main() {
  await migrate();
  const hash = await bcrypt.hash(PW, 10);
  await qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ('super@ecole.tn',$1,'superadmin','Plateforme','Super-administrateur',NULL) ON CONFLICT (email) DO NOTHING", [hash]);
  for (const [i, e] of ECOLES.entries()) {
    const ex = (await qa('SELECT id FROM schools WHERE slug=$1', [e.slug])).rows[0];
    if (ex && (await qa('SELECT 1 FROM users WHERE school_id=$1 LIMIT 1', [ex.id])).rowCount) { console.log(`[seed-ecoles] ${e.nom} : déjà présente, ignorée.`); continue; }
    if (ex) await purger(ex.id); // reste d'une création interrompue
    await creerEcole(e, i, hash);
    console.log(`[seed-ecoles] ${e.nom} : créée.`);
  }
  // École d'origine (« Abou Kacem Chebbi ») : complétée pour avoir des données aussi cohérentes que les autres écoles
  await require('./scripts/completer-ecoles').completerEcoleOrigine({ hash });
  console.log('\n' + await documenter(hash));
}
module.exports = { ECOLES, NIVEAUX, MATIERES, FAMILLES, ADULTES, GARCONS, FILLES, ENS_NOMS, ENS_PRENOMS, RUES, PW, pad, tel };
if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => end());

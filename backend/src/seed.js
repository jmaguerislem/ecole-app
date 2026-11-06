// Jeu de données de démonstration (à lancer UNE fois sur une base vide) : npm run seed
const bcrypt = require('bcryptjs');
const { q, qa, runWith, end } = require('./db');
const migrate = require('./migrate');
const config = require('./config');

async function seed() {
  if ((await q('SELECT COUNT(*) n FROM classes')).rows[0].n > 0) { console.log('Données déjà présentes : seed ignoré.'); return; }
  const A = config.anneeCourante;
  const pw = process.env.SEED_PASSWORD || 'Demo@2026!';
  const hash = await bcrypt.hash(pw, 10);
  const user = async (email, role, nom, prenom, extra = {}) =>
    (await q(`INSERT INTO users(email,password_hash,role,nom,prenom,telephone,specialite) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO UPDATE SET nom=EXCLUDED.nom, password_hash=EXCLUDED.password_hash RETURNING id`,
      [email, hash, role, nom, prenom, extra.tel || null, extra.spec || null])).rows[0].id;
  const admin = await user('admin@ecole.tn', 'admin', 'Direction', 'École');
  const compta = await user('compta@ecole.tn', 'comptable', 'Ben Ali', 'Sonia');
  const ens1 = await user('ens1@ecole.tn', 'enseignant', 'Trabelsi', 'Karim', { spec: 'Instituteur 1ère année' });
  const ens2 = await user('ens2@ecole.tn', 'enseignant', 'Gharbi', 'Leila', { spec: 'Instituteur 2ème année' });
  const par1 = await user('parent1@mail.tn', 'parent', 'Mejri', 'Hatem', { tel: '20111222' });
  const par2 = await user('parent2@mail.tn', 'parent', 'Jlassi', 'Amel', { tel: '98333444' });
  const eleveU = await user('eleve1@ecole.tn', 'eleve', 'Mejri', 'Yassine');
  const cls = async (niveau, section, tit) => (await q('INSERT INTO classes(niveau,section,capacite,titulaire_id,annee_scolaire) VALUES ($1,$2,25,$3,$4) RETURNING id', [niveau, section, tit, A])).rows[0].id;
  const cp = await cls('1ère année', 'A', ens1), ce1 = await cls('2ème année', 'A', ens2);
  const mat = async (n, c) => (await q('INSERT INTO matieres(nom,coefficient) VALUES ($1,$2) RETURNING id', [n, c])).rows[0].id;
  const fr = await mat('Français', 3), ma = await mat('Mathématiques', 3), ar = await mat('Arabe', 2), ev = await mat('Éveil scientifique', 1);
  for (const [e, c] of [[ens1, cp], [ens2, ce1]]) for (const m of [fr, ma, ar, ev]) await q('INSERT INTO affectations(enseignant_id,matiere_id,classe_id,annee_scolaire) VALUES ($1,$2,$3,$4)', [e, m, c, A]);
  const s1 = (await q("INSERT INTO salles(nom,capacite) VALUES ('Salle 1',25) RETURNING id")).rows[0].id;
  const s2 = (await q("INSERT INTO salles(nom,capacite) VALUES ('Salle 2',25) RETURNING id")).rows[0].id;
  const eleves = [];
  const names = [['Mejri', 'Yassine', cp, eleveU], ['Mejri', 'Salma', ce1, null], ['Jlassi', 'Omar', cp, null], ['Jlassi', 'Nour', cp, null], ['Hamdi', 'Aya', ce1, null], ['Saidi', 'Adam', ce1, null]];
  for (const [i, [n, p, c, u]] of names.entries()) {
    const id = (await q('INSERT INTO eleves(nom,prenom,date_naissance,sexe,annee_entree,classe_id,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [n, p, c === cp ? '2020-04-12' : '2019-06-03', i % 2 ? 'F' : 'M', A, c, u])).rows[0].id;
    await q('UPDATE eleves SET matricule=$1 WHERE id=$2', [`E${A.slice(0, 4)}${String(id).padStart(4, '0')}`, id]);
    eleves.push(id);
  }
  for (const [e, p] of [[0, par1], [1, par1], [2, par2], [3, par2]]) await q('INSERT INTO eleve_parents(eleve_id,parent_id) VALUES ($1,$2)', [eleves[e], p]);
  const cren = (c, m, e, s, j, d, f) => q('INSERT INTO creneaux(classe_id,matiere_id,enseignant_id,salle_id,jour,heure_debut,heure_fin,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [c, m, e, s, j, d, f, A]);
  await cren(cp, fr, ens1, s1, 1, '08:00', '09:00'); await cren(cp, ma, ens1, s1, 1, '09:15', '10:15'); await cren(cp, ar, ens1, s1, 2, '08:00', '09:00');
  await cren(ce1, fr, ens2, s2, 1, '08:00', '09:00'); await cren(ce1, ma, ens2, s2, 2, '09:00', '10:00');
  const tar = async (l, t, m) => (await q('INSERT INTO tarifs(annee_scolaire,libelle,type,montant) VALUES ($1,$2,$3,$4) RETURNING id', [A, l, t, m])).rows[0].id;
  const tIns = await tar('Frais d\'inscription', 'inscription', 100);
  const NIV = ['1ère année', '2ème année', '3ème année', '4ème année', '5ème année', '6ème année']; // un prix par niveau (+50 DT/an ensuite, automatique)
  for (const [i, n] of NIV.entries()) await q("INSERT INTO tarifs(annee_scolaire,libelle,type,niveau,montant) VALUES ($1,$2,'scolarite',$3,$4)", [A, `Scolarité – ${n}`, n, 600 + 50 * i]);
  const pay = (e, m, mode) => q("INSERT INTO paiements(eleve_id,tarif_id,montant,mode,annee_scolaire,created_by,numero_recu) VALUES ($1,$2,$3,$4,$5,$6,$7)", [eleves[e], tIns, m, mode, A, compta, `REC-${A.slice(0, 4)}-DEMO${e}`]);
  await pay(0, 100, 'especes'); await pay(1, 400, 'virement');
  for (const [c, m, t] of [[cp, fr, 'Dictée 1'], [cp, ma, 'Contrôle calcul'], [cp, fr, 'Lecture']]) {
    const evId = (await q("INSERT INTO evaluations(classe_id,matiere_id,titre,trimestre,date_eval,bareme,annee_scolaire,created_by) VALUES ($1,$2,$3,1,CURRENT_DATE,20,$4,$5) RETURNING id", [c, m, t, A, ens1])).rows[0].id;
    for (const [i, e] of [0, 2, 3].entries()) await q('INSERT INTO notes(evaluation_id,eleve_id,valeur,annee_scolaire) VALUES ($1,$2,$3,$4)', [evId, eleves[e], [15, 12.5, 17][(i + evId) % 3], A]);
  }
  await q("INSERT INTO devoirs(titre,description,matiere_id,classe_id,enseignant_id,date_remise,annee_scolaire) VALUES ('Exercices page 12','Résoudre les exercices 1 à 5.',$1,$2,$3, now() + interval '5 days',$4)", [ma, cp, ens1, A]);
  await q("INSERT INTO annonces(auteur_id,titre,corps,audience) VALUES ($1,'Rentrée scolaire','La rentrée aura lieu le 15 septembre à 8h00. Bienvenue à tous !','tous')", [admin]);
  console.log(`Seed terminé. Comptes de démonstration (mot de passe : ${pw}) : super@ecole.tn (super-admin), admin@ecole.tn, compta@ecole.tn, ens1@ecole.tn, ens2@ecole.tn, parent1@mail.tn, parent2@mail.tn, eleve1@ecole.tn`);
}

(async () => {
  await migrate();
  const school = (await qa('SELECT id, nom FROM schools ORDER BY id LIMIT 1')).rows[0];
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD || 'Demo@2026!', 10);
  await qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ('super@ecole.tn',$1,'superadmin','Plateforme','Super-administrateur',NULL) ON CONFLICT (email) DO NOTHING", [hash]);
  await runWith({ schoolId: school.id, schoolNom: school.nom }, seed);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => end());


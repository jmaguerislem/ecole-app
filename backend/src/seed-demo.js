// Prépare la démonstration du projet : npm run seed:demo   (Docker : docker compose exec app node src/seed-demo.js)
//  1) charge le jeu de base (seed.js) puis les écoles de démonstration complètes (seed-ecoles.js : 5 écoles, déjà présentes = ignorées, relançable sans doublon) ;
//  2) enregistre les comptes des boutons « Comptes de démonstration » de la page de connexion (table demo_accounts) :
//       École 1 = Habib Bourguiba (Tunis) · École 2 = Ibn Khaldoun (Sfax) · École 3 = Les Oliviers (Sousse)
//       rôles : administrateur, comptable, enseignant, élève, parent → vrais comptes de la base (aucun mot de passe stocké ici) ;
//  3) crée des contrats de location et des loyers de démonstration pour ces 3 écoles (page « Statistiques financières ») :
//       École 1 à jour, École 2 avec des loyers en retard, École 3 avec un paiement partiel. Ce sont des données DE DÉMONSTRATION
//       enregistrées en base comme n'importe quel loyer réel ; en production, ne lancez pas ce script.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { qa, end } = require('./db');
const migrate = require('./migrate');
const V = require('./services/validate');
const L = require('./services/loyers');
const { ECOLES } = require('./seed-ecoles');

const GROUPES = ECOLES.slice(0, 3); // École 1, 2, 3
const COMPTES = (slug) => ({ admin: `directeur@${slug}.tn`, comptable: `compta@${slug}.tn`, enseignant: `ens1@${slug}.tn`, eleve: `eleve1@${slug}.tn`, parent: `parent1@${slug}.tn` });
// Loyer mensuel et profil de paiement des 3 écoles : { payes: nombre d'échéances échues réglées en totalité, partiel: montant du versement partiel suivant }
const LOYERS = [{ loyer: 3500, payes: 'toutes' }, { loyer: 2800, payes: 8 }, { loyer: 4200, payes: 'toutes-sauf-derniere', partiel: 2000 }];

async function comptesDemo() {
  let n = 0;
  for (const [i, e] of GROUPES.entries()) {
    const school = (await qa('SELECT id FROM schools WHERE slug=$1', [e.slug])).rows[0];
    if (!school) throw new Error(`École de démonstration introuvable : ${e.slug}`);
    for (const [role, email] of Object.entries(COMPTES(e.slug))) {
      const u = (await qa('SELECT id FROM users WHERE email=$1 AND school_id=$2 AND role=$3 AND deleted_at IS NULL', [email, school.id, role])).rows[0];
      if (!u) throw new Error(`Compte de démonstration introuvable : ${email} (${role})`);
      await qa('INSERT INTO demo_accounts(groupe,role,user_id) VALUES ($1,$2,$3) ON CONFLICT (groupe,role) DO UPDATE SET user_id=EXCLUDED.user_id', [i + 1, role, u.id]);
      // Les comptes de démonstration ne demandent jamais de changement de mot de passe
      await qa('UPDATE users SET must_change_password=FALSE, actif=TRUE WHERE id=$1', [u.id]);
      n++;
    }
  }
  console.log(`[seed-demo] ${n} comptes de démonstration enregistrés (3 écoles × 5 rôles).`);
}

async function loyersDemo() {
  const today = V.aujourdhui();
  const an = Number(today.slice(0, 4));
  const owner = (await qa("SELECT id FROM users WHERE role='superadmin' AND deleted_at IS NULL ORDER BY id LIMIT 1")).rows[0];
  for (const [i, e] of GROUPES.entries()) {
    const school = (await qa('SELECT id FROM schools WHERE slug=$1', [e.slug])).rows[0];
    if ((await qa('SELECT 1 FROM school_contracts WHERE school_id=$1', [school.id])).rowCount) { console.log(`[seed-demo] ${e.nom} : contrat de location déjà présent, ignoré.`); continue; }
    const p = LOYERS[i];
    await L.enregistrerContrat(school.id, { loyer_mensuel: p.loyer, jour_echeance: 5, date_debut: `${an}-01-01`, date_fin: null, caution: p.loyer * 2, notes: 'Contrat de démonstration' });
    const dues = (await qa('SELECT id, periode, echeance FROM loyer_echeances WHERE school_id=$1 AND echeance<=$2 ORDER BY periode', [school.id, today])).rows;
    const aPayer = p.payes === 'toutes' ? dues : p.payes === 'toutes-sauf-derniere' ? dues.slice(0, -1) : dues.slice(0, p.payes);
    let k = 0;
    for (const d of aPayer) {
      const jour = new Date(`${String(d.echeance).slice(0, 10)}T12:00:00Z`); jour.setUTCDate(jour.getUTCDate() + 1 + (k % 3));
      const date = jour.toISOString().slice(0, 10) > today ? today : jour.toISOString().slice(0, 10);
      const virement = k % 2 === 0;
      await L.encaisser(d.id, { montant: p.loyer, date_paiement: date, mode: virement ? 'virement' : 'especes', reference: virement ? `VIR-${an}-${String(i + 1)}${String(k + 1).padStart(2, '0')}` : undefined }, owner?.id ?? null);
      k++;
    }
    if (p.partiel && dues[aPayer.length]) await L.encaisser(dues[aPayer.length].id, { montant: p.partiel, date_paiement: today, mode: 'especes' }, owner?.id ?? null);
    console.log(`[seed-demo] ${e.nom} : contrat (${p.loyer} TND/mois) et ${aPayer.length} loyer(s) encaissé(s)${p.partiel ? ' + 1 paiement partiel' : ''}.`);
  }
}

async function main() {
  await migrate();
  // Jeu de base (école d'origine, ignoré s'il est déjà présent) puis les écoles de démonstration
  for (const f of ['seed.js', 'seed-ecoles.js']) execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', env: process.env });
  await comptesDemo();
  await loyersDemo();
  console.log('[seed-demo] Terminé : ouvrez la page de connexion, bloc « Comptes de démonstration ».');
}
module.exports = { main, GROUPES, COMPTES };
if (require.main === module) main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => end());

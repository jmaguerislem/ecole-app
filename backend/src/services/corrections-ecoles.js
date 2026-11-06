// Corrections de données des deux écoles « Abou Kacem Chebbi », appliquées UNE seule fois (repère dans `data_migrations`) :
//  1) l'école de Nabeul est renommée pour ne plus être confondue avec l'école d'origine (même nom à une lettre près) ;
//  2) l'école de Nabeul passe au statut « Actif » ;
//  3) les coordonnées manquantes (ville, adresse, téléphone, e-mail, fin d'abonnement) sont complétées, sans jamais écraser une valeur déjà saisie.
// L'ajout de données de démonstration à l'école d'origine (classes, enseignants, élèves…) se fait à part : `npm run ecoles:completer`.
const { qa } = require('../db');

const NOM_NABEUL_ANCIEN = 'École Primaire Abou el Kacem Chebbi';
const NOM_NABEUL = 'École Primaire Abou el Kacem Chebbi – Nabeul';
const COORDONNEES = {
  'ecole-primaire-abou-kacem-chebbi': { // école d'origine (créée à partir de ECOLE_NOM)
    ville: 'Tozeur', adresse: 'Avenue Abou el Kacem Chebbi, 2200 Tozeur', telephone: '76 450 210', email_contact: 'contact@ecole-primaire-abou-kacem-chebbi.tn',
  },
  'abou-el-kacem': { // école de Nabeul
    ville: 'Nabeul', adresse: '27 avenue Farhat Hached, 8000 Nabeul', telephone: '72 285 402', email_contact: 'contact@abou-el-kacem.tn',
  },
};
const MARQUE = 'ecoles-abou-kacem-chebbi-v1';

async function appliquer() {
  if ((await qa('SELECT 1 FROM data_migrations WHERE nom=$1', [MARQUE])).rowCount) return false;
  const nabeul = (await qa("SELECT id, nom FROM schools WHERE slug='abou-el-kacem'")).rows[0];
  const origine = (await qa("SELECT id FROM schools WHERE slug='ecole-primaire-abou-kacem-chebbi'")).rows[0];
  if (nabeul) {
    if (nabeul.nom === NOM_NABEUL_ANCIEN) await qa('UPDATE schools SET nom=$1 WHERE id=$2', [NOM_NABEUL, nabeul.id]);
    await qa("UPDATE schools SET status='active' WHERE id=$1", [nabeul.id]);
  }
  for (const [slug, c] of Object.entries(COORDONNEES)) {
    if (!(slug === 'abou-el-kacem' ? nabeul : origine)) continue;
    await qa(
      `UPDATE schools SET ville=COALESCE(NULLIF(ville,''),$2), adresse=COALESCE(NULLIF(adresse,''),$3), telephone=COALESCE(NULLIF(telephone,''),$4),
         email_contact=COALESCE(NULLIF(email_contact,''),$5), subscription_end=COALESCE(subscription_end, CURRENT_DATE + INTERVAL '1 year')
       WHERE slug=$1`, [slug, c.ville, c.adresse, c.telephone, c.email_contact]);
  }
  // Le repère n'est posé qu'une fois l'école de Nabeul traitée : tant qu'elle n'existe pas, on réessaie au démarrage suivant
  if (!nabeul) return false;
  await qa('INSERT INTO data_migrations(nom) VALUES ($1) ON CONFLICT DO NOTHING', [MARQUE]);
  console.log('[migrate] Écoles « Abou Kacem Chebbi » : renommage, statut et coordonnées mis à jour.');
  return true;
}
module.exports = { appliquer, NOM_NABEUL, COORDONNEES };

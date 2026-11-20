const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const now = new Date();
const y = now.getFullYear();
const defaultYear = now.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
const prod = process.env.NODE_ENV === 'production';

// Valeurs d'exemple publiées dans le dépôt (.env.example, docker-compose.yml) : n'importe qui les connaît, elles ne protègent rien.
const SECRETS_PUBLICS = ['change-me-please-with-a-long-random-string', 'remplacez-moi-par-une-longue-chaine-aleatoire-32-car-min', 'dev-only-secret-change-me'];
if (prod && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || SECRETS_PUBLICS.includes(process.env.JWT_SECRET))) {
  throw new Error('JWT_SECRET est obligatoire en production : 32 caractères minimum et différent des valeurs d\'exemple (générez-en un avec : openssl rand -hex 32).');
}
// Hors production, sans JWT_SECRET : secret aléatoire propre au processus (les sessions sont perdues au redémarrage, ce qui est sans gravité en développement).
// Une valeur fixe et publique permettrait de forger un jeton administrateur sur tout serveur lancé sans NODE_ENV=production.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || SECRETS_PUBLICS.includes(jwtSecret)) {
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (!prod && process.env.JWT_SECRET === undefined) console.warn('[config] JWT_SECRET absent : secret temporaire généré (les connexions seront perdues au redémarrage).');
}

// Vérification d'adresse e-mail à l'inscription d'une école : activée dès qu'un SMTP est configuré (VERIFY_SIGNUP_EMAIL=true/false pour forcer).
// Lue à chaque appel (et non une fois pour toutes) pour que les tests puissent la basculer.
const verifierEmailInscription = () => (process.env.VERIFY_SIGNUP_EMAIL ? process.env.VERIFY_SIGNUP_EMAIL === 'true' : !!process.env.SMTP_HOST);

let firebase = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { firebase = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT n\'est pas un JSON valide (collez le fichier du compte de service Firebase sur une seule ligne).'); }
}

module.exports = {
  prod,
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  databaseUrl: process.env.DATABASE_URL || 'postgres://ecole:ecole@localhost:5432/ecole',
  dbSsl: process.env.DATABASE_SSL === 'true',
  anneeCourante: process.env.ANNEE_SCOLAIRE || defaultYear,
  ecoleNom: process.env.ECOLE_NOM || 'École Primaire Abou Kacem Chebbi', // nom de l'école créée automatiquement lors de la migration
  plateformeNom: process.env.PLATEFORME_NOM || 'Gestion scolaire',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || '',
  // Comptes de démonstration de la page de connexion (connexion SANS mot de passe) : activés par défaut hors production, à n'activer en production (DEMO_LOGIN=true) que pour une présentation.
  demoLogin: process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === 'true' : !prod,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  smtp: process.env.SMTP_HOST
    ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : null,
  mailFrom: process.env.MAIL_FROM || 'ecole@example.com',
  // Notifications push de l'application mobile (Firebase Cloud Messaging) : JSON du compte de service Firebase, en une ligne
  firebase,
  verifierEmailInscription,
  vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT || 'mailto:ecole@example.com' }
    : null,
};

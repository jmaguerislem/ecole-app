const path = require('path');
require('dotenv').config();

const now = new Date();
const y = now.getFullYear();
const defaultYear = now.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
const prod = process.env.NODE_ENV === 'production';

if (prod && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET (32 caractères minimum) est obligatoire en production.');
}

module.exports = {
  prod,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
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
  firebase: process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null,
  vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT || 'mailto:ecole@example.com' }
    : null,
};

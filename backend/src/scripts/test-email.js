// Vérifie la configuration e-mail (Gmail, SendGrid, autre SMTP) SANS jamais afficher ni demander le mot de passe.
// Usage : npm run mail:test                      → vérifie la connexion et l'authentification au serveur SMTP
//         npm run mail:test -- vous@gmail.com    → envoie en plus un e-mail de test à cette adresse
const config = require('../config');
const { envoyerEmail, verifierSmtp } = require('../services/mailer');
const V = require('../services/validate');

(async () => {
  if (!config.smtp) throw new Error('SMTP non configuré : renseignez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et MAIL_FROM dans backend/.env (voir le README, section « E-mail avec Gmail »).');
  console.log(`Serveur : ${config.smtp.host}:${config.smtp.port} · utilisateur : ${config.smtp.user || '(aucun)'} · expéditeur : ${config.mailFrom}`);
  const v = await verifierSmtp();
  if (!v.ok) throw new Error(`Connexion refusée : ${v.error}\n→ Gmail : utilisez un « mot de passe d'application » (validation en 2 étapes requise), pas votre mot de passe habituel.`);
  console.log('✔ Connexion et authentification SMTP réussies.');
  const to = process.argv[2];
  if (!to) return console.log('Astuce : ajoutez une adresse pour recevoir un e-mail de test : npm run mail:test -- vous@gmail.com');
  const r = await envoyerEmail({ to: V.email(to), subject: `[${config.ecoleNom}] Test d'envoi d'e-mail`, text: `Bonjour,\n\nCeci est un e-mail de test envoyé par l'application ${config.ecoleNom}.\nSi vous le lisez, l'envoi d'e-mails fonctionne.\n` });
  if (!r.ok) throw new Error(`Envoi échoué : ${r.error}`);
  console.log(`✔ E-mail de test envoyé à ${to}. Vérifiez la boîte de réception (et les courriers indésirables).`);
})().catch((e) => { console.error('✘', e.message); process.exitCode = 1; });

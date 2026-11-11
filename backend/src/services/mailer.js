// Envoi d'e-mails avec résultat explicite (jamais d'exception) : { ok, error }.
//  - SMTP configuré (SMTP_HOST…)  : envoi réel via nodemailer.
//  - MAIL_TRANSPORT=memory        : les messages sont gardés en mémoire (`sent`) – utilisé par les tests.
//  - sinon                        : { ok:false, error:'SMTP non configuré' } (le compte reste créé, l'administrateur peut « Renvoyer »).
const nodemailer = require('nodemailer');
const config = require('../config');

const transport = config.smtp
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null;
const sent = []; // boîte d'envoi mémoire
const memory = () => process.env.MAIL_TRANSPORT === 'memory';
let forcerEchec = null; // tests : simule une panne SMTP

async function envoyerEmail({ to, subject, text }) {
  if (forcerEchec) return { ok: false, error: forcerEchec };
  if (memory()) { sent.push({ to, subject, text, at: new Date() }); return { ok: true }; }
  if (!transport) return { ok: false, error: 'SMTP non configuré (définir SMTP_HOST…)' };
  try { await transport.sendMail({ from: config.mailFrom, to, subject, text }); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
}
module.exports = { envoyerEmail, sent, simulerEchec: (m) => { forcerEchec = m; } };

const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { q, currentSchool } = require('../db');
const config = require('../config');

const mailer = config.smtp
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null;
if (config.vapid) webpush.setVapidDetails(config.vapid.subject, config.vapid.pub, config.vapid.priv);

// Firebase Cloud Messaging (application mobile) : chargé uniquement si FIREBASE_SERVICE_ACCOUNT est défini
let fcm = null;
function getFcm() {
  if (!config.firebase) return null;
  if (!fcm) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(config.firebase) });
    fcm = admin.messaging();
  }
  return fcm;
}
async function sendFcm(token, { titre, corps, lien }) {
  await getFcm().send({ token, notification: { title: titre, body: corps || '' }, data: { url: lien || '/' }, android: { priority: 'high' } });
}

const log = (user_id, canal, sujet, statut, erreur = null) =>
  q('INSERT INTO notification_log(user_id,canal,sujet,statut,erreur) VALUES ($1,$2,$3,$4,$5)', [user_id, canal, sujet, statut, erreur]).catch(() => {});

// Notification interne + push (si configuré) + e-mail (option). Journalise chaque envoi.
async function notify(userIds, { type, titre, corps, lien }, { email = false } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const id of ids) {
    try {
      await q('INSERT INTO notifications(user_id,type,titre,corps,lien) VALUES ($1,$2,$3,$4,$5)', [id, type, titre, corps, lien]);
      await log(id, 'interne', titre, 'envoye');
    } catch (e) { await log(id, 'interne', titre, 'echec', e.message); }
    if (config.vapid || config.firebase) {
      const subs = (await q('SELECT * FROM push_subscriptions WHERE user_id=$1', [id])).rows;
      for (const s of subs) {
        try {
          if (s.endpoint.startsWith('fcm:')) { if (!config.firebase) continue; await sendFcm(s.endpoint.slice(4), { titre, corps, lien }); }
          else { if (!config.vapid) continue; await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: titre, body: corps, url: lien })); }
          await log(id, 'push', titre, 'envoye');
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410 || e.code === 'messaging/registration-token-not-registered') await q('DELETE FROM push_subscriptions WHERE id=$1', [s.id]);
          await log(id, 'push', titre, 'echec', e.message);
        }
      }
    }
  }
  if (email && mailer && ids.length) {
    const users = (await q('SELECT id,email FROM users WHERE id = ANY($1) AND actif AND deleted_at IS NULL', [ids])).rows;
    for (const u of users) {
      try {
        await mailer.sendMail({ from: config.mailFrom, to: u.email, subject: `[${currentSchool()?.schoolNom || config.plateformeNom}] ${titre}`, text: `${corps || ''}\n\n${config.appUrl}${lien || ''}` });
        await log(u.id, 'email', titre, 'envoye');
      } catch (e) { await log(u.id, 'email', titre, 'echec', e.message); }
    }
  }
}

// Envoi d'un message interne (utilisé aussi par les paiements/relances)
async function sendMessage({ sender_id, recipients, objet, corps, eleve_id = null, thread_id = null, attachments = [], email = false }) {
  const { rows } = await q(
    `INSERT INTO messages(sender_id,thread_id,eleve_id,objet,corps,statut,attachments,sent_at) VALUES ($1,$2,$3,$4,$5,'envoye',$6,now()) RETURNING id`,
    [sender_id, thread_id, eleve_id, objet, corps, JSON.stringify(attachments)]);
  const id = rows[0].id;
  for (const uid of recipients) await q('INSERT INTO message_recipients(message_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, uid]);
  await notify(recipients, { type: 'message', titre: `Nouveau message : ${objet}`, corps: corps.slice(0, 140), lien: `/messagerie/${id}` }, { email });
  return id;
}

module.exports = { notify, sendMessage, log };

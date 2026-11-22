// Notifications : UN SEUL point d'entrée pour le site web ET l'application mobile.
// Le serveur est la source de vérité : une notification interne est enregistrée en base (cloche web, liste mobile, compteur de non-lus
// partagé), puis envoyée en push à TOUS les appareils du destinataire (navigateurs Web Push + téléphones FCM) et, selon la politique
// ci-dessous, par e-mail. Les deux plateformes appellent les mêmes routes : les règles sont donc identiques par construction.
const webpush = require('web-push');
const { q, currentSchool } = require('../db');
const config = require('../config');
const { envoyerEmail, mailerDisponible } = require('./mailer'); // un seul transport e-mail pour toute l'application (délais d'attente, mode test)
if (config.vapid) webpush.setVapidDetails(config.vapid.subject, config.vapid.pub, config.vapid.priv);

// ---- Politique d'e-mail par type d'événement (modifiable ici, et seulement ici) ----
// true  = le destinataire reçoit aussi un e-mail (en plus de la notification interne et du push)
// false = notification interne + push uniquement (événements fréquents ou à faible enjeu)
// Un appel peut la surcharger ponctuellement : notify(ids, notif, { email: false }) (ex. : le compte d'un élève mineur).
const POLITIQUE_EMAIL = {
  message: true, annonce: true, absence: true, retard: true, reclamation: true, remplacement: true, preinscription: true,
  devoir: false, correction: false, depot: false, note: false,
};
const emailVoulu = (type, option) => (typeof option === 'boolean' ? option : POLITIQUE_EMAIL[type] === true);

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
// Les valeurs de « data » doivent être des chaînes (exigence FCM). L'application mobile s'en sert pour ouvrir la bonne page
// (url) et marquer la notification comme lue (id) ; Android affiche lui-même la notification quand l'application est fermée.
async function envoiFcm(token, { titre, corps, lien, id, type }) {
  await getFcm().send({
    token,
    notification: { title: titre, body: corps || '' },
    data: { url: lien || '/', id: String(id || ''), type: String(type || '') },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });
}
async function envoiWeb(sub, { titre, corps, lien, id, type }) {
  await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys },
    JSON.stringify({ title: titre, body: corps, url: lien, id, type, tag: id ? `n${id}` : undefined }), { TTL: 86400 });
}
// Les envois réels sont remplaçables (tests : aucun appel réseau vers Firebase / un navigateur).
const envoi = { fcm: envoiFcm, web: envoiWeb };

const log = (user_id, canal, sujet, statut, erreur = null) =>
  q('INSERT INTO notification_log(user_id,canal,sujet,statut,erreur) VALUES ($1,$2,$3,$4,$5)', [user_id, canal, sujet, statut, erreur]).catch(() => {});

const MORT = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

// Envoi push vers tous les appareils d'un utilisateur, en parallèle. Un appareil en échec n'empêche pas les autres.
async function pousser(userId, notif) {
  const subs = (await q('SELECT * FROM push_subscriptions WHERE user_id=$1', [userId])).rows;
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    const mobile = s.endpoint.startsWith('fcm:');
    if (mobile ? !config.firebase : !config.vapid) { await log(userId, 'push', notif.titre, 'ignore', mobile ? 'FCM non configuré (FIREBASE_SERVICE_ACCOUNT)' : 'Web Push non configuré (VAPID_*)'); return; }
    try {
      if (mobile) await envoi.fcm(s.endpoint.slice(4), notif); else await envoi.web(s, notif);
      ok++; await log(userId, 'push', notif.titre, 'envoye');
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410 || MORT.has(e.code)) await q('DELETE FROM push_subscriptions WHERE id=$1', [s.id]); // appareil désinstallé / abonnement expiré
      await log(userId, 'push', notif.titre, 'echec', e.message);
    }
  }));
  return ok;
}

// notify(userIds, { type, titre, corps, lien, cle }, { email })
//  - destinataires : comptes actifs et non supprimés uniquement (dédoublonnés) ;
//  - cle : identité de l'événement (ex. « absence:12:2026-11-03:matin »). Un même événement n'est JAMAIS notifié deux fois à la
//    même personne (nouvelle tentative réseau, double clic, appel refait depuis le site ou l'application…) ; contrainte unique en base ;
//  - e-mail : politique par type (POLITIQUE_EMAIL), surchargeable avec { email }.
// Retourne le décompte { internes, push, emails, doublons } (utile aux tests et aux journaux).
async function notify(userIds, { type, titre, corps, lien, cle = null }, { email } = {}) {
  const demandes = [...new Set((userIds || []).filter(Boolean))];
  const bilan = { internes: 0, push: 0, emails: 0, doublons: 0 };
  if (!demandes.length) return bilan;
  const users = (await q('SELECT id,email FROM users WHERE id = ANY($1::int[]) AND actif AND deleted_at IS NULL', [demandes])).rows;
  const parEmail = emailVoulu(type, email);
  const aEnvoyer = [];
  for (const u of users) {
    try {
      const r = await q(
        'INSERT INTO notifications(user_id,type,titre,corps,lien,cle) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, cle) WHERE cle IS NOT NULL DO NOTHING RETURNING id',
        [u.id, type, titre, corps, lien, cle]);
      if (!r.rowCount) { bilan.doublons++; continue; } // déjà notifié pour cet événement : ni push ni e-mail en double
      bilan.internes++; await log(u.id, 'interne', titre, 'envoye');
      aEnvoyer.push({ u, id: r.rows[0].id });
    } catch (e) { await log(u.id, 'interne', titre, 'echec', e.message); }
  }
  if (config.vapid || config.firebase) {
    const lots = await Promise.all(aEnvoyer.map(({ u, id }) => pousser(u.id, { titre, corps, lien, id, type }).catch(() => 0)));
    bilan.push = lots.reduce((a, b) => a + b, 0);
  } else {
    // Aucun service push configuré : on le consigne (au lieu de l'ignorer en silence) pour les seuls utilisateurs ayant des appareils
    for (const { u } of aEnvoyer) {
      const n = (await q('SELECT COUNT(*)::int n FROM push_subscriptions WHERE user_id=$1', [u.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
      if (n) await log(u.id, 'push', titre, 'ignore', 'Push non configuré (VAPID_* / FIREBASE_SERVICE_ACCOUNT)');
    }
  }
  if (parEmail) {
    const sujet = `[${currentSchool()?.schoolNom || config.plateformeNom}] ${titre}`;
    const texte = (corps) => `${corps || ''}\n\n${config.appUrl}${lien || ''}`;
    for (const { u } of aEnvoyer) {
      if (!u.email) { await log(u.id, 'email', titre, 'ignore', 'Aucune adresse e-mail'); continue; }
      if (!mailerDisponible()) { await log(u.id, 'email', titre, 'ignore', 'SMTP non configuré (SMTP_HOST…)'); continue; }
      const r = await envoyerEmail({ to: u.email, subject: sujet, text: texte(corps) });
      if (r.ok) bilan.emails++;
      await log(u.id, 'email', titre, r.ok ? 'envoye' : 'echec', r.ok ? null : r.error);
    }
  }
  return bilan;
}

// Envoi d'un message interne (utilisé aussi par les paiements/relances)
async function sendMessage({ sender_id, recipients, objet, corps, eleve_id = null, thread_id = null, attachments = [], email }) {
  const { rows } = await q(
    `INSERT INTO messages(sender_id,thread_id,eleve_id,objet,corps,statut,attachments,sent_at) VALUES ($1,$2,$3,$4,$5,'envoye',$6,now()) RETURNING id`,
    [sender_id, thread_id, eleve_id, objet, corps, JSON.stringify(attachments)]);
  const id = rows[0].id;
  for (const uid of recipients) await q('INSERT INTO message_recipients(message_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, uid]);
  await notify(recipients, { type: 'message', titre: `Nouveau message : ${objet}`, corps: corps.slice(0, 140), lien: `/messagerie/${id}`, cle: `message:${id}` }, { email });
  return id;
}

module.exports = { notify, sendMessage, log, envoi, POLITIQUE_EMAIL };

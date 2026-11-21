// Comptes parents créés automatiquement + e-mail d'accueil.
//  - Ajout d'un élève : le compte parent est créé s'il n'existe pas (identifiant = e-mail du parent), avec un MOT DE PASSE TEMPORAIRE généré par le serveur
//    (haché bcrypt en base, jamais journalisé) envoyé au parent avec les informations de son enfant (nom, prénom, classe).
//    Le compte porte `must_change_password` : le parent doit choisir son propre mot de passe à la première connexion (l'API refuse tout le reste avant).
//  - Un parent est identifié par son e-mail : jamais de doublon dans une école ; plusieurs enfants → un seul compte, simplement rattaché (e-mail d'information).
//  - Le CODE à usage unique (72 h, haché en base, 5 essais) subsiste pour « mot de passe oublié » (/auth/forgot-password, /auth/set-password).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { qa } = require('../db');
const config = require('../config');
const V = require('./validate');
const { HttpError } = require('../util');
const { envoyerEmail } = require('./mailer');
const { verifierQuota } = require('./quotas');

const VALIDITE_H = 72;
const MAX_ESSAIS = 5;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
const sha = (s) => crypto.createHash('sha256').update(String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
// Mot de passe temporaire : 12 caractères lisibles (sans 0/O/1/I/l), au moins une majuscule, une minuscule, un chiffre et un symbole
function motDePasseTemporaire() {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const MAJ = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const MIN = 'abcdefghijkmnopqrstuvwxyz'; const NUM = '23456789'; const SYM = '#@$%*+?!';
  const chars = [pick(MAJ), pick(MIN), pick(NUM), pick(SYM)];
  while (chars.length < 12) chars.push(pick(MAJ + MIN + NUM));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
const nouveauCode = () => Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
const formaterCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

// Trouve ou crée le compte parent (DANS la transaction `client` de l'école). Renvoie { id, cree, email, motDePasseTemporaire }.
// `motDePasseTemporaire` n'existe que pour un compte qui vient d'être créé : à transmettre à inviterParent() APRÈS validation de la transaction.
async function trouverOuCreerParent(client, { nom, prenom, email, telephone }, { schoolId } = {}) {
  const mail = V.email(email, "L'e-mail du parent");
  const nomP = V.nomPropre(nom, 'Le nom du parent'); const prenomP = V.nomPropre(prenom, 'Le prénom du parent');
  if (telephone) { const t = String(telephone); if (!/^\d{8}$/.test(t)) throw new HttpError(400, 'Le téléphone du parent doit contenir exactement 8 chiffres'); }
  // Même adresse déjà utilisée ? (compte visible par l'école via RLS = même école)
  const dansEcole = (await client.query('SELECT id, role FROM users WHERE email=$1 AND deleted_at IS NULL', [mail])).rows[0];
  if (dansEcole) {
    if (dansEcole.role !== 'parent') throw new HttpError(409, "Cette adresse e-mail est déjà utilisée par un compte qui n'est pas un compte parent.");
    return { id: dansEcole.id, cree: false, email: mail };
  }
  // Une adresse déjà utilisée dans une AUTRE école ne gêne pas : l'e-mail n'est unique que dans une école (le parent aura un compte distinct dans celle-ci)
  await verifierQuota(schoolId, 'utilisateurs');
  const temporaire = motDePasseTemporaire();
  const u = (await client.query(
    "INSERT INTO users(email,password_hash,role,nom,prenom,telephone,consentement_rgpd_at,mot_de_passe_defini,must_change_password) VALUES ($1,$2,'parent',$3,$4,$5,now(),TRUE,TRUE) RETURNING id",
    [mail, await bcrypt.hash(temporaire, 12), nomP, prenomP, telephone || null])).rows[0];
  return { id: u.id, cree: true, email: mail, motDePasseTemporaire: temporaire };
}

// Génère un nouveau code (invalide les précédents) – pool propriétaire (la table est réservée à la plateforme)
async function creerCode(userId) {
  const code = nouveauCode();
  await qa('UPDATE password_setup_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [userId]);
  await qa("INSERT INTO password_setup_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now() + ($3 || ' hours')::interval)", [userId, sha(code), String(VALIDITE_H)]);
  return code;
}

const libelleEnfant = (e) => `${e.prenom} ${e.nom} – classe : ${e.classe || 'à affecter'}`;

function corpsEmail({ ecole, parent, enfants, email, motDePasse, nouveauCompte }) {
  const intro = nouveauCompte ? `Bienvenue à ${ecole} !` : `Un nouvel enfant vient d'être rattaché à votre compte parent à ${ecole}.`;
  const bloc = enfants.length === 1
    ? `Votre enfant a été inscrit(e) :\n  - ${libelleEnfant(enfants[0])}`
    : `Vos enfants inscrits :\n${enfants.map((e) => `  - ${libelleEnfant(e)}`).join('\n')}`;
  const acces = nouveauCompte
    ? `Voici vos identifiants pour accéder à votre espace parent :\n\n  Adresse de connexion : ${config.appUrl}\n  Identifiant : ${email}\n  Mot de passe temporaire : ${motDePasse}\n\n` +
      `Pour votre sécurité, vous devrez choisir un nouveau mot de passe dès votre première connexion. Ne communiquez ce mot de passe à personne.`
    : `Connectez-vous avec votre identifiant habituel :\n\n  Adresse de connexion : ${config.appUrl}\n  Identifiant : ${email}\n\nVotre mot de passe n'a pas changé.`;
  return `Bonjour ${parent.prenom} ${parent.nom},\n\n${intro}\n\n${bloc}\n\nVous pouvez consulter son suivi scolaire depuis votre espace parent (notes, absences, emploi du temps, paiements).\n\n${acces}\n\nCordialement,\n${ecole}`;
}

// Envoie l'e-mail au parent. Journalise le résultat. Ne lève jamais d'exception.
//  - tempPassword : mot de passe temporaire d'un compte qui vient d'être créé (renvoyé par trouverOuCreerParent)
//  - renvoi : « Renvoyer l'invitation » → nouveau mot de passe temporaire (ancien invalidé), à changer à la prochaine connexion
//  - sinon, compte existant déjà activé : simple e-mail d'information (nouvel enfant rattaché), mot de passe inchangé
async function inviterParent({ userId, ecole, tempPassword = null, renvoi = false }) {
  try {
    const u = (await qa('SELECT id,email,nom,prenom,school_id,mot_de_passe_defini,must_change_password FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) return { ok: false, error: 'Compte introuvable' };
    const enfants = (await qa(
      `SELECT e.prenom, e.nom, c.niveau||COALESCE(' '||c.section,'') AS classe FROM eleves e JOIN eleve_parents ep ON ep.eleve_id=e.id
         LEFT JOIN classes c ON c.id=e.classe_id WHERE ep.parent_id=$1 AND e.deleted_at IS NULL ORDER BY e.id`, [userId])).rows;
    let motDePasse = tempPassword;
    // Compte jamais activé (ancienne invitation par code) ou renvoi demandé : nouveau mot de passe temporaire
    if (!motDePasse && (renvoi || !u.mot_de_passe_defini)) {
      motDePasse = motDePasseTemporaire();
      await qa('UPDATE users SET password_hash=$2, mot_de_passe_defini=TRUE, must_change_password=TRUE WHERE id=$1', [userId, await bcrypt.hash(motDePasse, 12)]);
    }
    const nouveauCompte = !!motDePasse;
    const r = await envoyerEmail({
      to: u.email,
      subject: `[${ecole}] ${nouveauCompte ? 'Bienvenue – vos identifiants de connexion' : 'Nouvel enfant rattaché à votre compte'}`,
      text: corpsEmail({ ecole, parent: u, enfants, email: u.email, motDePasse, nouveauCompte }),
    });
    await qa('UPDATE users SET invitation_envoyee_at=$2, invitation_erreur=$3 WHERE id=$1', [userId, r.ok ? new Date() : null, r.ok ? null : r.error]);
    await qa("INSERT INTO notification_log(school_id,user_id,canal,sujet,statut,erreur) VALUES ($1,$2,'email',$3,$4,$5)", [u.school_id, userId, nouveauCompte ? 'Identifiants du compte parent' : 'Nouvel enfant rattaché au compte parent', r.ok ? 'envoye' : 'echec', r.ok ? null : r.error]).catch(() => {});
    return r;
  } catch (e) {
    console.error('[invitation]', e.message);
    return { ok: false, error: 'Erreur interne lors de l\'envoi' };
  }
}

const ROLES_LIBELLE = { admin: 'de direction (administrateur)', enseignant: 'enseignant', comptable: 'de comptabilité', parent: 'parent', eleve: 'élève' };

// Compte créé par un administrateur d'école (enseignant, comptable, personnel…) : e-mail de confirmation avec l'identifiant et le mot de passe INITIAL.
// Ce mot de passe est provisoire : le compte est créé avec `must_change_password` (changement obligatoire dès la première connexion, l'API refuse tout le reste avant).
// Appelé APRÈS validation de la transaction ; ne lève jamais d'exception (un échec d'envoi n'annule pas la création : l'état est renvoyé à l'administrateur).
async function envoyerIdentifiants({ userId, ecole, motDePasse }) {
  try {
    const u = (await qa('SELECT id,email,nom,prenom,role,school_id FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) return { ok: false, error: 'Compte introuvable' };
    const r = await envoyerEmail({
      to: u.email,
      subject: `[${ecole}] Votre compte a été créé`,
      text: `Bonjour ${u.prenom} ${u.nom},\n\nVotre compte ${ROLES_LIBELLE[u.role] || ''} a été créé à ${ecole}.\n\nVoici vos identifiants de connexion :\n\n  Adresse de connexion : ${config.appUrl}\n  Identifiant (e-mail) : ${u.email}\n  Mot de passe provisoire : ${motDePasse}\n\n` +
        `Pour votre sécurité, vous devrez choisir votre propre mot de passe dès votre première connexion. Ne communiquez ce mot de passe à personne.\nSi vous n'attendiez pas ce message, ignorez-le ou contactez l'école.\n\nCordialement,\n${ecole}`,
    });
    await qa('UPDATE users SET invitation_envoyee_at=$2, invitation_erreur=$3 WHERE id=$1', [userId, r.ok ? new Date() : null, r.ok ? null : r.error]);
    await qa("INSERT INTO notification_log(school_id,user_id,canal,sujet,statut,erreur) VALUES ($1,$2,'email',$3,$4,$5)", [u.school_id, userId, 'Identifiants du nouveau compte', r.ok ? 'envoye' : 'echec', r.ok ? null : r.error]);
    return r;
  } catch (e) {
    console.error('[identifiants]', e.message);
    return { ok: false, error: 'Erreur interne lors de l\'envoi' };
  }
}

// Définition du mot de passe avec le code reçu. Messages volontairement génériques (pas d'énumération de comptes).
// Une même adresse peut exister dans plusieurs écoles : un code est envoyé pour chaque compte, et c'est le code saisi qui désigne le compte concerné.
async function definirMotDePasse({ email, code, password }) {
  const GENERIC = new HttpError(400, 'Code invalide ou expiré. Demandez un nouveau code depuis l\'écran de connexion.');
  const mail = String(email || '').toLowerCase().trim();
  const comptes = (await qa('SELECT id, email_a_verifier FROM users WHERE email=$1 AND deleted_at IS NULL AND actif ORDER BY id LIMIT 10', [mail])).rows;
  let trouve = null; const essayes = [];
  for (const c of comptes) {
    const t = (await qa('SELECT * FROM password_setup_tokens WHERE user_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1', [c.id])).rows[0];
    if (!t) continue;
    if (t.essais >= MAX_ESSAIS) { await qa('UPDATE password_setup_tokens SET used_at=now() WHERE id=$1', [t.id]); continue; }
    const a = Buffer.from(sha(code)); const b = Buffer.from(t.token_hash);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) { trouve = c; break; }
    essayes.push(t.id);
  }
  if (!trouve) { for (const id of essayes) await qa('UPDATE password_setup_tokens SET essais=essais+1 WHERE id=$1', [id]); throw GENERIC; }
  V.motDePasse(password, 'Le mot de passe');
  if (String(password).toLowerCase() === mail) throw new HttpError(400, "Le mot de passe ne doit pas être identique à l'e-mail");
  // Le code est arrivé dans la boîte du titulaire : l'adresse est de ce fait prouvée (un compte d'inscription en attente devient utilisable)
  await qa('UPDATE users SET password_hash=$2, mot_de_passe_defini=TRUE, must_change_password=FALSE, email_a_verifier=FALSE WHERE id=$1', [trouve.id, await bcrypt.hash(String(password), 12)]);
  await qa('UPDATE password_setup_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [trouve.id]);
  if (trouve.email_a_verifier) await notifierNouvelleEcole(trouve.id, { confirme: true });
  return { ok: true };
}

// Nouvelle école inscrite en libre-service : prévient le(s) super-administrateur(s) par e-mail (+ SUPERADMIN_NOTIFY_EMAIL, liste séparée par des virgules)
// et garde une trace dans le journal (affichée sur l'accueil du super-administrateur). Ne lève jamais d'exception : l'inscription n'en dépend pas.
async function notifierNouvelleEcole(userId, { confirme = false } = {}) {
  try {
    const d = (await qa(`SELECT u.email, u.school_id, s.nom, s.slug, s.plan, s.status, s.subscription_end, s.created_at
                         FROM users u JOIN schools s ON s.id=u.school_id WHERE u.id=$1`, [userId])).rows[0];
    if (!d) return;
    // La trace est écrite avant de rendre la main (rapide) ; seul l'envoi des e-mails (réseau, parfois lent) se poursuit en arrière-plan
    await qa("INSERT INTO audit_log(school_id,user_id,action,entite,entite_id,nouvelles) VALUES ($1,$2,'inscription_ecole','schools',$1,$3)",
      [d.school_id, userId, JSON.stringify({ nom: d.nom, slug: d.slug, email: d.email, email_confirme: confirme })]);
    envoyerNotification(d, confirme).catch((e) => console.error('[notification inscription]', e.message));
  } catch (e) { console.error('[notification inscription]', e.message); }
}
async function envoyerNotification(d, confirme) {
  const supers = (await qa("SELECT id, email FROM users WHERE role='superadmin' AND actif AND deleted_at IS NULL")).rows;
  const extra = String(process.env.SUPERADMIN_NOTIFY_EMAIL || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x));
  const destinataires = new Map(); for (const s of supers) destinataires.set(s.email, s.id); for (const e of extra) if (!destinataires.has(e)) destinataires.set(e, null);
  const jour = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
  const text = `Une nouvelle école vient de s'inscrire sur ${config.plateformeNom}.\n\n  École : ${d.nom}\n  Identifiant (lien) : ${d.slug}\n  E-mail de la direction : ${d.email} (${confirme ? 'adresse confirmée' : 'adresse non vérifiée'})\n  Formule : ${d.plan} · Statut : ${d.status}\n  Inscrite le : ${jour(d.created_at)} · Fin de l'essai : ${jour(d.subscription_end)}\n  Lien de pré-inscription : ${config.appUrl}/preinscription/${d.slug}\n\nGérer les écoles : ${config.appUrl}/ecoles\n`;
  for (const [to, superId] of destinataires) {
    const r = await envoyerEmail({ to, subject: `[${config.plateformeNom}] Nouvelle école inscrite : ${d.nom}`, text });
    await qa("INSERT INTO notification_log(school_id,user_id,canal,sujet,statut,erreur) VALUES ($1,$2,'email',$3,$4,$5)", [d.school_id, superId, `Nouvelle école inscrite : ${d.nom}`, r.ok ? 'envoye' : 'echec', r.ok ? null : r.error]).catch(() => {});
  }
}

// Inscription libre-service : e-mail contenant le code qui prouve que l'adresse appartient bien à la personne qui s'inscrit. Ne lève jamais d'exception.
async function envoyerCodeVerification(userId) {
  try {
    const u = (await qa('SELECT u.id,u.email,u.prenom,u.nom,s.nom AS ecole FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=$1 AND u.email_a_verifier AND u.deleted_at IS NULL', [userId])).rows[0];
    if (!u) return { ok: false, error: 'Compte introuvable' };
    const code = await creerCode(u.id);
    return await envoyerEmail({ to: u.email, subject: `[${config.plateformeNom}] Confirmez votre adresse e-mail`, text:
      `Bonjour,\n\nVous venez de créer l'école « ${u.ecole} » sur ${config.plateformeNom}.\nPour confirmer que cette adresse e-mail est bien la vôtre, saisissez ce code (usage unique, valable ${VALIDITE_H} h) :\n\n  Code : ${formaterCode(code)}\n\nSaisissez-le sur ${config.appUrl}/verifier-email\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message : aucun compte ne sera activé.\n` });
  } catch (e) { console.error('[verification]', e.message); return { ok: false, error: 'Erreur interne lors de l\'envoi' }; }
}

// Confirme l'adresse avec le code reçu. Messages volontairement génériques (pas d'énumération de comptes).
async function verifierEmail({ email, code }) {
  const GENERIC = new HttpError(400, 'Code invalide ou expiré. Demandez un nouveau code.');
  const mail = String(email || '').toLowerCase().trim();
  const u = (await qa('SELECT id FROM users WHERE email=$1 AND email_a_verifier AND actif AND deleted_at IS NULL', [mail])).rows[0];
  if (!u) throw GENERIC;
  const t = (await qa('SELECT * FROM password_setup_tokens WHERE user_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1', [u.id])).rows[0];
  if (!t) throw GENERIC;
  if (t.essais >= MAX_ESSAIS) { await qa('UPDATE password_setup_tokens SET used_at=now() WHERE id=$1', [t.id]); throw GENERIC; }
  const a = Buffer.from(sha(code)); const b = Buffer.from(t.token_hash);
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) { await qa('UPDATE password_setup_tokens SET essais=essais+1 WHERE id=$1', [t.id]); throw GENERIC; }
  await qa('UPDATE users SET email_a_verifier=FALSE WHERE id=$1', [u.id]);
  await qa('UPDATE password_setup_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [u.id]);
  await notifierNouvelleEcole(u.id, { confirme: true });
  return { ok: true };
}

// « Première connexion / mot de passe oublié » : répond toujours pareil (aucune fuite sur l'existence du compte)
// Une même adresse peut avoir un compte dans plusieurs écoles : un e-mail (avec son propre code) est envoyé pour chacun, l'objet indique l'école.
async function reinitialiser(email) {
  try {
    const mail = String(email || '').toLowerCase().trim();
    const comptes = (await qa(`SELECT u.id,u.email,u.nom,u.prenom,u.actif,u.role,s.nom AS ecole FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.email=$1 AND u.deleted_at IS NULL AND u.actif AND u.role<>'superadmin' ORDER BY u.id LIMIT 10`, [mail])).rows;
    for (const u of comptes) {
      const code = await creerCode(u.id);
      const r = await envoyerEmail({ to: u.email, subject: `[${u.ecole}] Définir votre mot de passe`, text:
        `Bonjour ${u.prenom} ${u.nom},\n\nVoici votre code pour définir un nouveau mot de passe pour votre compte à ${u.ecole} (usage unique, valable ${VALIDITE_H} h) :\n\n  Identifiant : ${u.email}\n  Code : ${formaterCode(code)}\n\nSaisissez-le sur ${config.appUrl}/mot-de-passe-oublie\nSi vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.\n` });
      if (!r.ok) console.error('[reinitialisation] e-mail non envoyé :', r.error);
    }
  } catch (e) { console.error('[reinitialisation]', e.message); }
}

module.exports = { envoyerIdentifiants, notifierNouvelleEcole, envoyerCodeVerification, verifierEmail, reinitialiser, trouverOuCreerParent, inviterParent, definirMotDePasse, creerCode, motDePasseTemporaire, VALIDITE_H };

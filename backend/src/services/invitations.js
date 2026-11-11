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
  const dansEcole = (await client.query('SELECT id, role, deleted_at FROM users WHERE email=$1', [mail])).rows[0];
  if (dansEcole) {
    if (dansEcole.deleted_at) throw new HttpError(409, 'Cette adresse e-mail correspond à un compte supprimé : utilisez une autre adresse.');
    if (dansEcole.role !== 'parent') throw new HttpError(409, "Cette adresse e-mail est déjà utilisée par un compte qui n'est pas un compte parent.");
    return { id: dansEcole.id, cree: false, email: mail };
  }
  // Adresse utilisée dans une AUTRE école (e-mail unique dans toute la base) : refus explicite, sans révéler laquelle
  if ((await qa('SELECT 1 FROM users WHERE email=$1', [mail])).rowCount) throw new HttpError(409, "Cette adresse e-mail est déjà utilisée sur la plateforme (autre établissement) : utilisez une autre adresse pour ce parent.");
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

// Définition du mot de passe avec le code reçu. Messages volontairement génériques (pas d'énumération de comptes).
async function definirMotDePasse({ email, code, password }) {
  const GENERIC = new HttpError(400, 'Code invalide ou expiré. Demandez un nouveau code depuis l\'écran de connexion.');
  const mail = String(email || '').toLowerCase().trim();
  const u = (await qa('SELECT id,actif FROM users WHERE email=$1 AND deleted_at IS NULL', [mail])).rows[0];
  if (!u || !u.actif) throw GENERIC;
  const t = (await qa('SELECT * FROM password_setup_tokens WHERE user_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1', [u.id])).rows[0];
  if (!t) throw GENERIC;
  if (t.essais >= MAX_ESSAIS) { await qa('UPDATE password_setup_tokens SET used_at=now() WHERE id=$1', [t.id]); throw GENERIC; }
  const a = Buffer.from(sha(code)); const b = Buffer.from(t.token_hash);
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) { await qa('UPDATE password_setup_tokens SET essais=essais+1 WHERE id=$1', [t.id]); throw GENERIC; }
  V.motDePasse(password, 'Le mot de passe');
  if (String(password).toLowerCase() === mail) throw new HttpError(400, "Le mot de passe ne doit pas être identique à l'e-mail");
  await qa('UPDATE users SET password_hash=$2, mot_de_passe_defini=TRUE, must_change_password=FALSE WHERE id=$1', [u.id, await bcrypt.hash(String(password), 12)]);
  await qa('UPDATE password_setup_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [u.id]);
  return { ok: true };
}

// « Première connexion / mot de passe oublié » : répond toujours pareil (aucune fuite sur l'existence du compte)
async function reinitialiser(email) {
  try {
    const mail = String(email || '').toLowerCase().trim();
    const u = (await qa(`SELECT u.id,u.email,u.nom,u.prenom,u.actif,u.role,s.nom AS ecole FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.email=$1 AND u.deleted_at IS NULL`, [mail])).rows[0];
    if (!u || !u.actif || u.role === 'superadmin') return;
    const code = await creerCode(u.id);
    const r = await envoyerEmail({ to: u.email, subject: `[${u.ecole}] Définir votre mot de passe`, text:
      `Bonjour ${u.prenom} ${u.nom},\n\nVoici votre code pour définir un nouveau mot de passe (usage unique, valable ${VALIDITE_H} h) :\n\n  Identifiant : ${u.email}\n  Code : ${formaterCode(code)}\n\nDans l'application, touchez « Première connexion / mot de passe oublié » puis saisissez ce code.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\n${u.ecole}` });
    if (!r.ok) console.error('[reinitialisation] e-mail non envoyé :', r.error);
  } catch (e) { console.error('[reinitialisation]', e.message); }
}

module.exports = { reinitialiser, trouverOuCreerParent, inviterParent, definirMotDePasse, creerCode, motDePasseTemporaire, VALIDITE_H };

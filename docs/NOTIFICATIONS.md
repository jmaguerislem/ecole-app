# Notifications et e-mails – site web + application mobile

## Principe
Le serveur est l'unique source de vérité. Le site et l'application appellent **les mêmes routes** ; chaque événement passe par
`backend/src/services/notify.js`, qui, pour chaque destinataire **actif** :

1. enregistre la notification interne (cloche web, liste + pastille mobile — même compteur, même état « lu ») ;
2. l'envoie en push à **tous** ses appareils : navigateurs (Web Push / VAPID) et téléphones (Firebase FCM, jeton `fcm:…`) ;
3. envoie un e-mail selon la **politique par type** (`POLITIQUE_EMAIL`, un seul endroit à modifier) ;
4. journalise chaque envoi (`notification_log`, page « Journaux » de l'administration) y compris les envois **ignorés** (SMTP/FCM/VAPID non configurés).

## Qui reçoit quoi
| Événement | Destinataires | Interne + push | E-mail |
|---|---|---|---|
| Message | destinataires choisis (droits vérifiés) | oui | oui |
| Annonce | audience (tous / parents / enseignants / élèves / personnes), sans l'auteur | oui | oui |
| Absence d'élève | parents ; compte de l'élève | oui | parents oui, élève **non** |
| Retard d'élève | parents ; compte de l'élève | oui | parents oui, élève **non** |
| Remplacement | enseignant remplaçant | oui | oui |
| Réclamation (nouvelle) | direction | oui | oui |
| Réclamation (traitée) | le parent concerné | oui | oui |
| Pré-inscription | direction + secrétariat | oui | oui |
| Paiement reçu / relance | parents (via un message) | oui | oui |
| Devoir, correction, dépôt, note | élèves + parents de la classe / enseignant / élève + parents | oui | non |

Changer une règle d'e-mail : modifier `POLITIQUE_EMAIL` dans `notify.js` (ou `{ email: true|false }` à l'appel).

## Anti-doublon
- **Clé d'événement** (`notifications.cle`, index unique par utilisateur) : un même événement (ex. `absence:<élève>:<jour>:<période>`) n'est notifié qu'une fois, même si l'appel est refait depuis le site ou l'application. Aucun push ni e-mail n'est alors renvoyé.
- **Messages** : le même message (même expéditeur, destinataires, texte) renvoyé dans les 30 s, ou en double clic simultané, n'est ni recréé ni renotifié.
- **Un appareil = un jeton** (`keys.device`) : après rotation du jeton FCM, l'ancien est supprimé.
- Un jeton passe au dernier compte connecté ; déconnexion = jeton retiré (web : abonnement du navigateur supprimé aussi).

## Mise en service
| Canal | Variables / fichiers |
|---|---|
| E-mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_URL` ; vérifier avec `npm run mail:test -- vous@exemple.tn` |
| Push navigateur | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`npx web-push generate-vapid-keys`) |
| Push mobile | Console Firebase → compte de service → `FIREBASE_SERVICE_ACCOUNT` (JSON sur une ligne) **côté serveur** ; et `google-services.json` dans `mobile/android/app/` **côté application** (nom de package `com.example.ecole_mobile`, à remplacer par le vôtre avant publication) |

Sans `google-services.json`, l'application se compile et fonctionne, sans push. Android 13+ : l'autorisation est demandée à la connexion.

## Limites connues
- Le propriétaire de la plateforme (sans école) n'a pas de notifications internes (il reçoit des e-mails, ex. nouvelle école).
- Changer la période d'une absence existante (matin → journée) ne renotifie pas les parents (comportement historique, inchangé).
- Mobile : les liens vers des pages sans équivalent mobile (devoirs, absences…) ouvrent la liste des notifications.
- iOS : le projet mobile ne contient que la cible Android.

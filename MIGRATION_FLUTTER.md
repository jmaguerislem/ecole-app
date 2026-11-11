# Migration vers Flutter – compte rendu

## 1. Ce qui a été livré

| Zone | Contenu |
|---|---|
| `mobile/` | Application **Flutter native** (43 fichiers Dart, ≈ 5 500 lignes) – voir `mobile/README.md` |
| `backend/` | Création automatique des comptes parents + e-mail sécurisé, espace propriétaire (contrats / loyers), règles de conflit d'emploi du temps renforcées |
| `frontend/` (web) | **Un seul message modifié** (validation de pré-inscription, `Entities.jsx`). Coque native Capacitor retirée : dossier `android/`, `capacitor.config.json`, `.env.native`, scripts `cap:*`. Les paquets `@capacitor/*` restent car le code web les importe encore. |

## 2. Vérifications réalisées (et leurs limites)

| Vérification | Résultat |
|---|---|
| Tests backend (61 existants + 20 nouveaux, PostgreSQL réel) | **81/81** |
| Migration appliquée 2 fois sur une base existante | idempotente, aucune donnée touchée |
| Analyse statique Dart (`dart analyze`) contre les sources du framework Flutter | **0 erreur, 0 avertissement** |
| Client API **réel** de l'app exécuté contre le serveur **réel** | **53/53** (rôles, finances, parents, conflits, isolation) |
| Build web (`vite build`) après modification | OK |

**Non vérifié** : rendu visuel et comportement des widgets sur émulateur, build Gradle/APK, envoi d'e-mail via *votre* SMTP, comportement sur téléphone réel. Le premier lancement sur le Pixel 7 peut révéler des défauts d'affichage que l'analyse statique ne détecte pas : n'hésitez pas à me les signaler.

## 3. Base de données (migration additive, `schema.sql`, appliquée au démarrage si `AUTO_MIGRATE=true`)
Uniquement des `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` : **rien n'est supprimé ni modifié**. **Faites une sauvegarde avant de déployer.**

- `school_contracts`, `loyer_echeances` (loyer **prévu**), `loyer_encaissements` (loyer **réellement encaissé**).
- `password_setup_tokens` (codes d'activation, seul le hachage SHA-256 est stocké).
- `schools.site` ; `users.invitation_envoyee_at`, `invitation_erreur`, `mot_de_passe_defini` (**TRUE par défaut** : les comptes existants continuent de fonctionner).
- Ces 4 nouvelles tables sont **interdites** au rôle applicatif des écoles (`REVOKE` dans `tenant.sql`, testé) : une école ne peut jamais lire vos loyers.

## 4. Comptes parents automatiques
À l'ajout d'un élève avec un parent (`parent: {nom, prenom, email, telephone}`) :
1. compte parent créé (ou **compte existant réutilisé** via l'e-mail, insensible à la casse → pas de doublon, un seul compte pour plusieurs enfants) et lié à l'élève, dans la même transaction ;
2. **aucun mot de passe** n'est généré ni envoyé : e-mail de bienvenue avec identifiant + **code d'activation à usage unique** (10 caractères, valable 72 h, 5 essais, haché en base) ; le parent choisit son mot de passe dans l'app (« Première connexion / mot de passe oublié ») ;
3. échec d'envoi : l'inscription est conservée, l'erreur est renvoyée à l'écran et mémorisée ; bouton **« Renvoyer l'invitation »** (nouveau code, l'ancien est invalidé) ;
4. e-mail déjà pris par un autre rôle ou par une autre école : refus 409 explicite, rien n'est créé.
Aussi appliqué à la **validation des pré-inscriptions** (l'ancien mot de passe temporaire affiché à l'administrateur a disparu).

## 5. Espace propriétaire
Menu latéral = **3 pages** : Accueil, Les écoles, Statistiques financières.
- Revenu = **uniquement** les encaissements. Une échéance impayée n'est jamais comptée comme encaissée (testé).
- Statuts : *payé* / *en attente* (échéance future) / *en retard* (échéance dépassée) ; versements partiels gérés ; trop-perçu et date future refusés.
- Filtres école / mois / année ; revenus mensuels (prévu vs encaissé) ; comparatif entre écoles ; retards (jours) ; prochaines échéances ; historique.

## 6. Emploi du temps – décisions à connaître
- Règles appliquées à la **création et à la modification**, côté serveur, et **en direct** dans l'app (`POST /api/creneaux/verifier`). Message précis (salle/enseignant, jour, créneau) + propositions de salles libres et de créneaux libres.
- **Concurrence** : verrou PostgreSQL par jour ; 8 créations simultanées identiques → 1 seule réussit (testé).
- Chevauchement strict : 08:00–09:00 puis 09:00–10:00 reste autorisé.
- **Salle partagée entre écoles** : le modèle n'avait pas de notion de local commun. J'ai ajouté un champ **« Site / bâtiment »** sur l'école : deux écoles de même site partagent leurs salles *de même nom* (« Salle 1 » = « Salle 1 »). Le message ne révèle jamais l'autre école. **Si vous aviez une autre idée de « même espace physique », dites-le-moi.**
- **Enseignant dans deux écoles** : impossible à détecter, car un compte enseignant appartient à une seule école (e-mail unique). Le contrôle porte sur toutes les classes et tous les emplois du temps *de l'école*.
- Pas de contrainte d'exclusion en base : elle aurait pu faire échouer la migration sur des données existantes déjà en conflit.

## 7. Ce qui n'est PAS repris dans l'application mobile
Le web reste complet ; l'app mobile couvre le cœur de chaque rôle mais **pas la totalité** des pages web. Absents du mobile : gestion des classes / matières / salles / utilisateurs / affectations / tarifs, traitement des pré-inscriptions, création de devoirs et remise de travaux, pièces jointes et photos, reçus et bulletins PDF, statistiques d'école, journaux d'audit, relances d'impayés, notifications push (FCM). Dites-moi lesquels vous voulez en priorité.

## 8. Limites connues
- Un encaissement de loyer saisi par erreur **ne peut pas être annulé** depuis l'app (pas d'écran d'annulation).
- Un parent avec des enfants dans **deux écoles différentes** a besoin de deux e-mails (l'e-mail est unique sur toute la plateforme, contrainte existante).
- À l'API, le champ `parent` reste facultatif (compatibilité) ; c'est l'écran mobile qui l'exige pour un nouvel élève.
- Le compte *élève* garde son mot de passe saisi par l'administrateur (comportement existant, inchangé).

## 9. Déploiement
1. Sauvegarde de la base. 2. Déployer le backend à jour (migration automatique). 3. Renseigner `SMTP_*`, `MAIL_FROM`, `APP_URL`. 4. Pour chaque école : renseigner le **contrat** (Les écoles → fiche → Contrat), et le **Site** si des locaux sont partagés. 5. Construire l'APK avec l'URL HTTPS du serveur (`mobile/README.md`).

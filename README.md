# Gestion d'école primaire – plateforme web multi-écoles (SaaS)

Application conforme au cahier des charges *« Application web de gestion d'école primaire – Déploiement mono-école »* (Dr Hamdi Hassen, ISG Sousse, 20/10/2026).

**Stack** : React 18 (Vite, PWA) · Node.js/Express · PostgreSQL · authentification **JWT** + mots de passe hachés **bcrypt** · API REST.

## Démarrage rapide

### Option 1 – Docker (le plus simple)
```bash
docker compose up --build
# → http://localhost:4000   (admin : admin@ecole.tn / ChangeMoi!2026 – à changer)
# Données de démonstration (optionnel) :
docker compose exec app node src/seed.js
```

### Option 2 – Développement local
Prérequis : Node 18+, PostgreSQL 14+.
```bash
createdb ecole        # ou : CREATE USER ecole PASSWORD 'ecole'; CREATE DATABASE ecole OWNER ecole;
cp backend/.env.example backend/.env      # adapter DATABASE_URL, JWT_SECRET…
npm run install:all
npm run seed          # crée le schéma + jeu de démonstration
npm run dev:backend   # API  : http://localhost:4000
npm run dev:frontend  # UI   : http://localhost:5173
```
Production sans Docker : `npm run build && NODE_ENV=production npm start` (le backend sert le frontend compilé sur un seul port).

### Comptes de démonstration (`npm run seed`, mot de passe `Demo@2026!`)
| Rôle | Identifiant |
|---|---|
| Administrateur | admin@ecole.tn *(mot de passe = `ADMIN_PASSWORD` si défini, sinon `Demo@2026!`)* |
| Comptable / Secrétariat | compta@ecole.tn |
| Enseignants | ens1@ecole.tn (1ère année), ens2@ecole.tn (2ème année) |
| Parents | parent1@mail.tn, parent2@mail.tn |
| Élève | eleve1@ecole.tn |

> **Avant toute mise en production** : définir un `JWT_SECRET` aléatoire (32+ caractères), changer le mot de passe admin, ne pas lancer le seed.

## Plateforme multi-écoles (SaaS)

Chaque école est isolée des autres : un utilisateur ne voit et ne modifie que les données de **son** école. Détail et correspondance avec le guide du cours : [`docs/ISOLATION-ECOLES.md`](docs/ISOLATION-ECOLES.md).

- **Super-administrateur** (propriétaire de la plateforme) : créé au démarrage depuis `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`, ou avec `npm run superadmin -- email motdepasse`. Il crée, modifie, suspend les écoles depuis la page **Écoles**, mais ne voit aucune donnée d'élève.
- **Nouvelle école** : page *Écoles* → *Nouvelle école* (nom, formule, fin d'abonnement, compte de la direction). Un mot de passe est généré s'il n'est pas fourni. La direction crée ensuite ses enseignants, parents, classes…
- **Lien de pré-inscription** de chaque école : `https://votre-site/preinscription/<identifiant-de-l-ecole>` (bouton « Copier le lien »).
- **Abonnement** : une école *suspendue*, ou dont la date de fin d'abonnement est dépassée, ne peut plus se connecter.
- **Mise à jour d'une installation existante** : au premier démarrage, les données actuelles sont rattachées à la première école (nom = `ECOLE_NOM`), les fichiers sont rangés dans `uploads/<id-école>/`. **Faites une sauvegarde avant.** Les utilisateurs doivent se reconnecter une fois.
- **Tests d'isolation** (deux écoles fictives, joués dans les deux sens) : `cd backend && DATABASE_URL=postgres://… npm test`. À relancer avant chaque mise à jour.

### Liste des écoles, élèves et écoles « Abou Kacem Chebbi »
- **Liste des écoles unique** : `GET /api/public/schools` (écoles ouvertes, publique) et `GET /api/saas/schools` (toutes, super-administrateur) partagent `backend/src/services/ecoles.js` ; côté interface, le composant `SchoolSelect` affiche partout le même libellé « Nom (Ville) » dans le même ordre (pré-inscription, page Écoles, en-tête). Deux écoles ne peuvent plus porter le même nom dans la même ville.
- **Ajout d'un élève** : plus de champ « Compte de connexion » ; « Mot de passe » + « Confirmer le mot de passe » sont obligatoires. Le serveur crée le compte (rôle élève, identifiant = e-mail de l'élève, mot de passe haché bcrypt) et le lie à l'élève. À la modification, un mot de passe vide laisse le compte inchangé. Ces comptes ne comptent pas dans le quota « utilisateurs ».
- **Écoles Abou Kacem Chebbi** : au prochain démarrage (migration, une seule fois), l'école de Nabeul devient « École Primaire Abou el Kacem Chebbi – Nabeul » (statut Actif) et les coordonnées manquantes des deux écoles sont complétées. Pour ajouter les données de démonstration cohérentes à l'école d'origine (Tozeur) : `cd backend && npm run ecoles:completer` (relançable sans doublon).

### Statistiques (directeur : son école · super-administrateur : toutes les écoles)
Page `/statistiques`, deux vues selon le rôle :
- **Directeur → « Statistiques de l'école »** (`frontend/src/pages/StatsEcole.jsx`, route `GET /api/stats/mon-ecole`, calcul dans `backend/src/services/stats-ecole.js`). Uniquement **sa** école : élèves (statuts, garçons/filles, sans classe), enseignants, parents, comptables, utilisateurs, classes (effectif, capacité, remplissage, absences), absences (justifiées ou non, par mois), présences, paiements (encaissé, par mode et par mois, dû, reste à payer, taux de recouvrement), évaluations et notes, devoirs, messages, annonces, pré-inscriptions, abonnement et quotas. Aucune donnée d'une autre école n'est renvoyée : `GET /api/stats/global` lui est refusé (403) et `GET /api/stats/ecole/:id` n'accepte que l'identifiant de son école (sinon 404).
- **Super-administrateur → « Statistiques globales »** (`StatsGlobales.jsx`, `GET /api/stats/global` et `/api/stats/ecole/:id`) : totaux et compteurs de toutes les écoles, écoles actives / suspendues / en essai, graphiques, détail d'une école au choix.

Les chiffres sont calculés en base à chaque appel et actualisés automatiquement (après chaque modification, toutes les 15 s, au retour sur l'onglet). **Isolation** : requêtes exécutées avec la sécurité par ligne de PostgreSQL (école de la session) **et** filtre explicite `school_id` ; chaque jointure vérifie que les deux lignes sont de la même école. **Présences** : l'application n'enregistre que les absences ; les présences sont déduites (élèves actifs scolarisés moins élèves absents ; le taux du mois est une estimation sur les jours de classe, lundi à samedi, une demi-journée d'absence comptant pour 0,5). **Contrôle des données** : `cd backend && npm run ecoles:verifier` (lecture seule) signale toute ligne qui référencerait une autre école ou qui serait sans `school_id`. Tests : `backend/tests/stats-ecole.test.js` (directeurs) et `backend/tests/stats.test.js` (super-administrateur).

### Inscription libre-service, formules et quotas
- **Inscription d'une école** : page publique `/inscription` (route `POST /api/public/signup`). L'école est créée en statut *essai*, formule *Basic*, pour 30 jours ; la direction se connecte aussitôt.
- **Quotas par formule** (`backend/src/services/quotas.js`) : Basic 50 élèves / 20 utilisateurs, Standard 200 / 80, Premium illimité. Au-delà, l'API répond 402 avec un message explicite (création, import CSV compris). Modifiez `LIMITES` pour ajuster.
- **Abonnements manuels** : page *Écoles* → boutons **+1 mois / +1 an** (passent aussi l'école en statut *Actif*).
- **Tests** : `backend/tests/saas.test.js` (inscription, quotas) en plus des tests d'isolation ; exécutés automatiquement par GitHub Actions (`.github/workflows/tests.yml`).

## Couverture du cahier des charges
| Exigence | Réalisation |
|---|---|
| Acteurs & RBAC (Admin, Enseignant, Parent, Élève, Comptable) | Middleware `allow(...)` + filtrage des données par rôle (un parent ne voit que ses enfants, un enseignant que ses classes) – `backend/src/auth.js`, `util.js` |
| CRUD sur toutes les entités + journalisation (utilisateur, date, anciennes/nouvelles valeurs) + suppression logique contrôlée | `backend/src/crud.js` (fabrique) + table `audit_log` ; suppression refusée si référencée, ou confirmation explicite (`?force=true`) |
| Inscriptions : pré-inscription en ligne publique, validation admin → dossier élève + compte parent, affectation auto/manuelle, contrôle des effectifs, import/export CSV | `/preinscription`, `/api/public/preinscriptions`, `/api/eleves/import`, `/export`, `/:id/auto-affectation` |
| Classes, matières, salles, affectations enseignant | Pages dédiées, suppression contrôlée |
| Emploi du temps + détection de conflits (enseignant, salle, classe) + vue calendrier jour/semaine | `Timetable.jsx`, `routes/scolarite.js` |
| Évaluations, notes, moyennes pondérées, bulletins PDF, rang, absences + justification parent | `Notes.jsx`, `Bulletins.jsx`, `services/bulletin.js`, `services/pdf.js` |
| Paiements (espèces/virement/mobile money), grille tarifaire, impayés, relances (manuelles + cron hebdo), reçus PDF | `Paiements.jsx`, `services/finance.js` |
| **Message automatique au parent après paiement** (montant, date, mode, solde, lien du reçu) + journalisation de l'envoi | `afterCommit` dans `routes/scolarite.js`, table `notification_log` |
| Devoirs : création/modif/suppression contrôlée, pièces jointes, dépôt élève (remplaçable avant échéance), notation + commentaire, correction visible après la date de remise, consultation parent + « vu », notifications | `routes/messagerie.js` (section devoirs), `Devoirs.jsx` |
| Messagerie : canaux enseignant↔parent, admin↔parent, admin↔élève ; droits par rôle ; **messages envoyés immuables** ; brouillons ; suppression côté destinataire (masquage) ; historique en lecture seule ; journal des accès | `routes/messagerie.js`, `Messagerie.jsx`, table `access_log` |
| Annonces immuables (annonce corrective), audience par rôle | `Annonces.jsx` |
| Notifications : in-app, push (Web Push/VAPID), e-mail (SMTP/SendGrid) | `services/notify.js` |
| `annee_scolaire` sur les tables métier ; historique pluriannuel | `schema.sql` (classes, affectations, creneaux, evaluations, notes, absences, tarifs, paiements, devoirs…) |
| RGPD : consentement parental, portabilité (`/api/rgpd/export/:id`), effacement (anonymisation, admin) | `routes/account.js` |
| Sécurité : bcrypt, JWT, HTTPS (via l'hébergeur), helmet, rate-limit sur login, validation, journalisation | `index.js` |
| PWA mobile-first, accessibilité (labels, focus, navigation clavier, `prefers-reduced-motion`) | `frontend/public/manifest.webmanifest`, `sw.js`, `styles.css` |

## Déploiement (Partie IV du cahier des charges)
L'image Docker unique (`Dockerfile`) sert l'API et le frontend. Variables : voir `.env.example`.

* **A – Démonstration** : lancer l'app en local puis `cloudflared tunnel --url http://localhost:4000`.
* **B – Railway / Render / Zeabur** : pousser le dépôt sur GitHub → « Deploy from GitHub » (Dockerfile détecté) → ajouter PostgreSQL (`DATABASE_URL` fournie ; mettre `DATABASE_SSL=true` si exigé) → définir `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_URL` → monter un volume sur `UPLOAD_DIR` pour les fichiers. Le schéma et le premier admin sont créés automatiquement au démarrage (`AUTO_MIGRATE`).
* **C – Domaine personnalisé** : acheter le domaine, CNAME/A vers l'hébergeur, HTTPS Let's Encrypt (automatique chez la plupart des hébergeurs), puis `APP_URL=https://ecole-aboukacem-chebbi.com`.
* **D – VPS** : `docker compose up -d` derrière Nginx + certbot.

### Sauvegarde / restauration
`scripts/backup.sh` (pg_dump + fichiers, rétention 30 jours, à planifier en cron) et `scripts/restore.sh`. Sur Railway/Render/Neon, activer en plus les sauvegardes managées.

## Choix de conception & limites connues

**Multi-écoles :** l'année scolaire (`ANNEE_SCOLAIRE`) est commune à toutes les écoles ; l'e-mail d'un compte est unique dans toute la base (un parent ayant des enfants dans deux écoles utilise deux adresses) ; les numéros de reçu et matricules automatiques sont uniques par école mais ne sont pas consécutifs ; pas encore de double authentification pour les directions ; le super-administrateur ne peut pas « entrer » dans une école (support à ajouter si besoin).

* **Stockage fichiers** : disque local (volume persistant) via `services/storage.js` ; pour S3, remplacer multer par `multer-s3` (point d'extension unique).
* **Reçus et bulletins PDF** générés à la volée (pdfkit) : toujours à jour, rien à stocker.
* **Enseignants/parents/élèves** sont des comptes `users` (rôle) ; l'élève est lié à son dossier via `eleves.user_id`, les parents via `eleve_parents`.
* **Photo élève** : champ URL (l'upload de photo peut s'ajouter via `storage.js`).
* **Export Excel** : CSV (séparateur `;`, UTF-8 avec BOM) ouvrable directement dans Excel.
* **Passage d'année** : créer les classes/tarifs de la nouvelle année (`ANNEE_SCOLAIRE` ou date automatique : bascule en septembre) ; les données de l'année précédente restent consultables via le filtre « Année ».
* Hors périmètre MVP (V2+) : multi-tenancy, back-office SaaS, bibliothèque, cantine/transport, évaluation par compétences, application native, visioconférence, anglais.
* Les URL de fichiers sont aléatoires (32 hex) et servies uniquement aux utilisateurs authentifiés ; un contrôle d'accès par fichier peut être ajouté si besoin.
* Aucun test automatisé n'est fourni : l'API a été vérifiée manuellement de bout en bout (auth, RBAC, capacité, conflits, paiement + message, devoirs, messagerie).

## Structure
```
backend/   API Express  (src/index.js, crud.js, routes/, services/, schema.sql, seed.js)
frontend/  React + Vite (src/pages, components, public/ = PWA)
scripts/   backup.sh, restore.sh
Dockerfile, docker-compose.yml, .env.example
```

## Évolutions récentes
- **Élèves** : classe (liste + « Ajouter une classe »), parents (liste + « Ajouter un parent »), photo (fichier ou caméra), e-mail généré automatiquement et unique (`prenom.nom@<école>.tn`, variantes en cas de doublon). Variable optionnelle : `ELEVE_EMAIL_DOMAINE`.
- **Comptes** : e-mails lisibles (copie en un clic), confirmation du mot de passe dans tous les formulaires (jamais affiché ni renvoyé).
- **Annonces** : destinataires = Personne personnalisée / Tous les élèves / Tous les enseignants / Tous les parents.
- **Tarifs** : un prix par niveau et par année, +50 DT automatiques chaque nouvelle année (`TARIF_AUGMENTATION_ANNUELLE`), historique complet conservé (table `tarifs_historique`).
- La migration (`npm run migrate` ou démarrage) est idempotente et renseigne l'e-mail des élèves existants.

## 5 écoles de démonstration
`npm run seed:ecoles` (Docker : `docker compose exec app node src/seed-ecoles.js`) crée 5 écoles complètes (direction, secrétariat, 6 enseignants, 18 parents, 30 élèves, classes, matières, emploi du temps, tarifs avec historique, paiements, notes, absences, annonces). Relançable sans risque (une école déjà présente est ignorée). La liste des comptes est dans `docs/COMPTES_DEMO.md` (mot de passe commun `Demo@2026!`).
**« Faire l'appel »** est réservé aux enseignants (dans leurs classes) ; la direction saisit/consulte les absences depuis la page Absences.

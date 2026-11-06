# Isolation entre écoles – ce qui a été fait

Correspondance avec le guide « Isolation entre écoles » (transformer une application mono-école en SaaS).

| Étape du guide | Réalisation dans le projet |
|---|---|
| **1. Lister les tables** | 25 tables appartiennent à une école (élèves, parents/enseignants/comptes, classes, matières, salles, affectations, emploi du temps, évaluations, notes, absences, tarifs, paiements, messages, destinataires, annonces, devoirs, dépôts, notifications, journaux, abonnements push…). Seule la table `schools` est commune. |
| **2. Table `schools` + `school_id`** | `backend/src/schema.sql` (table `schools` : nom, identifiant, statut `trial/active/suspended`, formule, fin d'abonnement) et `backend/src/tenant.sql` (colonne `school_id`, index, rattachement des données existantes à la première école). Le super-administrateur est le seul compte sans école. |
| **3. L'école vient de la connexion** | Le jeton contient l'école et elle est **revérifiée en base à chaque requête** (`backend/src/auth.js`). Aucun paramètre de l'adresse ou du formulaire n'est lu : `/api/eleves?school_id=2` est ignoré. À la création, `school_id` est ajouté automatiquement (valeur par défaut de la colonne, issue de la session). |
| **4. Filtrer en un seul endroit** | PostgreSQL *Row Level Security* : une politique `school_isolation` sur chaque table. L'application se connecte avec un rôle restreint (`ecole_app`, ni superutilisateur ni contournement de la RLS) et indique l'école courante à chaque requête (`backend/src/db.js`). Aucune requête SQL ne peut oublier le filtre. |
| **5. Zones de fuite** | *Numéros dans l'adresse* : lignes d'autres écoles invisibles → « introuvable ». *Fichiers* : dossier par école `uploads/<id>/`. *Exports, recherche, statistiques* : mêmes filtres (RLS) ; les statistiques d’un directeur ajoutent un filtre `school_id` explicite et ne renvoient que sa propre école (`backend/src/services/stats-ecole.js`), contrôlé par `npm run ecoles:verifier`. *Tâches de fond* : les relances hebdomadaires reçoivent l'école explicitement, école par école. *Doublons* : matricule et numéro de reçu uniques **par école** (`school_id, …`). *Cache* : aucun cache applicatif. *Noms d'utilisateur* : connexion par e-mail, unique dans toute la base. *Liens entre écoles* : un garde-fou en base (39 déclencheurs) interdit de relier une donnée à une donnée d'une autre école (ex. paiement d'une école sur l'élève d'une autre). |
| **6. Tester avec deux écoles fictives** | `backend/tests/isolation.test.js` : écoles Alpha et Bravo (direction, enseignant, parent, 3 élèves, paiements, notes, absences, annonces, messages, devoirs avec fichier), chaque scénario joué **dans les deux sens**. |
| **7. Automatiser** | `npm test` dans `backend/` : 24 tests (listes, accès par numéro, modification/suppression, fichiers/reçus/bulletins, exports/recherche/statistiques, parent, enseignant, liens croisés, annonces/relances, filtre en base, jeton falsifié, matricules, e-mails, super-administrateur, suspension d'école, pré-inscription, 40 requêtes simultanées). Vérifié : en désactivant volontairement une protection, les tests échouent. |
| **9. Comptes** | Mots de passe hachés (bcrypt), un compte = une école + un rôle, compte **super-administrateur** séparé des directions, double authentification à ajouter plus tard. |

## Comment ça marche, en bref

1. À la connexion, l'application retrouve le compte par son e-mail, vérifie l'abonnement de son école, puis émet un jeton qui contient l'école.
2. À chaque requête, l'école est relue en base et transmise à PostgreSQL.
3. PostgreSQL ne renvoie que les lignes de cette école, et refuse toute écriture vers une autre école.

## Limites connues

- L'année scolaire est commune à toutes les écoles.
- Un e-mail ne peut appartenir qu'à une école.
- Les numéros de reçu et matricules automatiques ne sont pas consécutifs par école.
- Pas de double authentification (à ajouter plus tard pour les directions).
- L'utilisateur PostgreSQL de l'application doit pouvoir créer un rôle (superutilisateur, comme dans `docker-compose.yml`, ou droit `CREATEROLE`), sinon la migration s'arrête avec un message explicite plutôt que de démarrer sans protection.

# École – application mobile Flutter

Application **native** Flutter (Dart, Material 3) qui remplace l'ancienne version Capacitor. Elle parle directement à l'API du dossier `../backend` (aucune WebView).

| Rôle | Écrans |
|---|---|
| **Propriétaire (super admin)** | Menu latéral à **3 pages** : *Accueil* (totaux + indicateurs), *Les écoles* (liste, fiche, ajout, modification, activation/désactivation, contrat), *Statistiques financières* (loyers prévus ≠ encaissés, filtres école/mois/année, graphiques, comparatif, retards, échéances, historique) |
| **Administration / secrétariat** | Accueil, élèves (ajout avec **création automatique du compte parent + e-mail**), emploi du temps (**conflits salle/enseignant/classe détectés en direct**), paiements, compte |
| **Enseignant** | Accueil, emploi du temps, appel, évaluations et saisie des notes |
| **Parent / élève** | Tous les enfants d'un seul compte : bulletin, absences (justification), devoirs, paiements, emploi du temps |
| **Tous** | Messagerie, annonces, notifications, changement de mot de passe |

## 1. Prérequis
- [Flutter](https://docs.flutter.dev/get-started/install) récent (Dart ≥ 3.9, soit Flutter ≥ 3.35) et Android Studio (SDK Android + émulateur).
- VS Code avec les extensions **Dart** et **Flutter** (recommandées automatiquement à l'ouverture du dossier `mobile`).
- Un émulateur **Pixel 7** : Android Studio → *Device Manager* → *Create device* → Pixel 7 → image système récente.
- Node.js ≥ 20 et PostgreSQL pour le backend.

## 2. Lancer le backend (terminal 1)
```powershell
cd backend
npm install
copy .env.example .env      # puis renseigner DATABASE_URL, JWT_SECRET, SUPERADMIN_*, et SMTP_* (e-mails)
npm run migrate             # applique schema.sql (migrations incluses, idempotentes)
npm run dev                 # API sur http://localhost:4000
```

## 3. Préparer et lancer l'application (terminal 2)
```powershell
cd mobile
.\tool\setup_android.ps1    # Windows (une seule fois). macOS/Linux : sh tool/setup_android.sh
flutter doctor              # tout doit être vert pour Android
flutter emulators           # repérer l'identifiant du Pixel 7
flutter emulators --launch <identifiant_pixel_7>
flutter run --dart-define=API_URL=http://10.0.2.2:4000
```
Le script `setup_android` exécute `flutter create --platforms=android` (génère le dossier `android/`), autorise le HTTP en clair **en debug uniquement**, ajoute la permission INTERNET (release) et règle le nom de l'application.

**Depuis VS Code** : ouvrez le dossier `mobile`, choisissez *Pixel 7* dans la barre d'état (en bas à droite), puis **F5** avec la configuration « École – Pixel 7 (backend local) » (`.vscode/launch.json`).

> `10.0.2.2` est l'adresse du PC vu depuis l'émulateur. Sur un téléphone réel, utilisez l'IP du PC (ex. `http://192.168.1.20:4000`) ou, mieux, l'URL **HTTPS** du serveur déployé.

## 4. Construire un APK
```powershell
flutter build apk --release --dart-define=API_URL=https://VOTRE-SERVEUR.onrender.com
```
(Le serveur de production doit être en HTTPS ; il faut y avoir déployé la version à jour du backend.)

## 5. Structure
```
lib/
  main.dart, app.dart          point d'entrée, thème, routage par rôle, retour au login si la session expire
  core/                        api_client (JWT, erreurs lisibles), auth_controller, token_store (chiffré), thème, formats, formulaires, composants UI/graphiques
  features/auth/               connexion, activation du compte parent par code
  features/superadmin/         accueil, écoles, fiche école, contrat, encaissement, statistiques financières
  features/admin/              élèves, parents, emploi du temps + conflits, paiements
  features/teacher/            appel, évaluations/notes
  features/family/             enfants, bulletin, absences, devoirs, paiements
  features/shared/             messagerie, annonces, notifications, compte, emploi du temps
```
Dépendances volontairement minimales : `http` et `flutter_secure_storage` (plus `flutter_localizations` du SDK).

## 6. Ce qui a été vérifié, et ce qui ne l'a pas été
Vérifié automatiquement : analyse statique Dart sans erreur ni avertissement ; exécution du **vrai client API de l'app** contre le **vrai backend** (53 contrôles : rôles, finances, comptes parents, conflits d'emploi du temps, isolation entre familles). **Non vérifié** : le rendu visuel et le comportement des widgets sur émulateur, le build Gradle, l'envoi réel d'e-mails via votre SMTP. Voir `../MIGRATION_FLUTTER.md`.

#!/usr/bin/env sh
# Initialise la partie Android du projet (macOS / Linux). À lancer UNE fois depuis le dossier mobile :
#   sh tool/setup_android.sh
set -e
cd "$(dirname "$0")/.."

flutter create --platforms=android --org tn.ecole --project-name ecole_mobile .

# 1) HTTP en clair autorisé en DEBUG seulement (backend local)
cp tool/android_debug_manifest.xml android/app/src/debug/AndroidManifest.xml

# 2) Permission INTERNET pour les builds release + nom affiché de l'application
MAIN=android/app/src/main/AndroidManifest.xml
if ! grep -q 'android.permission.INTERNET' "$MAIN"; then
  sed -i.bak '0,/<manifest[^>]*>/s//&\n    <uses-permission android:name="android.permission.INTERNET"\/>/' "$MAIN" && rm -f "$MAIN.bak"
fi
sed -i.bak 's/android:label="ecole_mobile"/android:label="École"/' "$MAIN" && rm -f "$MAIN.bak"

flutter pub get
echo "Terminé. Lancez : flutter run --dart-define=API_URL=http://10.0.2.2:4000"

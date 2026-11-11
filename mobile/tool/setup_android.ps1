# Initialise la partie Android du projet (Windows / PowerShell). À lancer UNE fois depuis le dossier mobile :
#   .\tool\setup_android.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

flutter create --platforms=android --org tn.ecole --project-name ecole_mobile .

# 1) HTTP en clair autorisé en DEBUG seulement (backend local)
Copy-Item "tool\android_debug_manifest.xml" "android\app\src\debug\AndroidManifest.xml" -Force

# 2) Permission INTERNET pour les builds release + nom affiché de l'application
$main = "android\app\src\main\AndroidManifest.xml"
$xml = Get-Content $main -Raw -Encoding UTF8
if ($xml -notmatch 'android.permission.INTERNET') {
  $xml = $xml -replace '(<manifest[^>]*>)', "`$1`n    <uses-permission android:name=`"android.permission.INTERNET`"/>"
}
$xml = $xml -replace 'android:label="ecole_mobile"', 'android:label="École"'
[System.IO.File]::WriteAllText((Resolve-Path $main), $xml, (New-Object System.Text.UTF8Encoding $false))

flutter pub get
Write-Host "`nTerminé. Lancez : flutter run --dart-define=API_URL=http://10.0.2.2:4000" -ForegroundColor Green

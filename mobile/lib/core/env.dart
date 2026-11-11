/// Configuration de l'application.
///
/// L'adresse de l'API se règle au lancement, sans modifier le code :
///   flutter run --dart-define=API_URL=http://10.0.2.2:4000
/// - Émulateur Android : 10.0.2.2 = le PC qui héberge le backend.
/// - Téléphone réel    : l'adresse IP locale du PC, ou l'URL HTTPS du serveur déployé.
class Env {
  static const String apiUrl =
      String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:4000');
  static const String appName = 'École';
}

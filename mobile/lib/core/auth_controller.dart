import 'package:flutter/widgets.dart';

import 'api_client.dart';
import 'token_store.dart';

class AppUser {
  final int id;
  final String email, role, nom, prenom;
  final String? schoolLabel;

  /// Mot de passe provisoire (compte créé par l'administration) : à changer avant tout usage.
  final bool mustChangePassword;
  const AppUser(
      {required this.id,
      required this.email,
      required this.role,
      required this.nom,
      required this.prenom,
      this.schoolLabel,
      this.mustChangePassword = false});

  factory AppUser.fromJson(Map<String, dynamic> j) {
    final school = j['school'];
    return AppUser(
      id: (j['id'] as num).toInt(),
      email: '${j['email']}',
      role: '${j['role']}',
      nom: '${j['nom']}',
      prenom: '${j['prenom']}',
      schoolLabel:
          school is Map ? (school['label'] ?? school['nom'])?.toString() : null,
      mustChangePassword: j['must_change_password'] == true,
    );
  }

  String get fullName => '$prenom $nom';
  String get initials =>
      '${prenom.isNotEmpty ? prenom[0] : ''}${nom.isNotEmpty ? nom[0] : ''}'
          .toUpperCase();

  static const roleLabels = {
    'superadmin': 'Propriétaire',
    'admin': 'Administration',
    'comptable': 'Secrétariat',
    'enseignant': 'Enseignant',
    'parent': 'Parent',
    'eleve': 'Élève',
  };
  String get roleLabel => roleLabels[role] ?? role;
}

/// État d'authentification de toute l'application.
class AuthController extends ChangeNotifier {
  AppUser? user;
  bool ready = false;
  bool sessionExpired = false;

  AuthController() {
    api.onUnauthorized = () {
      if (user != null) logout(expired: true);
    };
  }

  Future<void> restore() async {
    final t = await TokenStore.read();
    if (t != null) {
      api.token = t;
      try {
        user = AppUser.fromJson(await api.getMap('/auth/me'));
      } on ApiException catch (e) {
        // Réseau coupé : on garde le jeton pour le prochain lancement ; sinon la session est invalide.
        if (e.status != 0) {
          api.token = null;
          await TokenStore.write(null);
        }
      }
    }
    ready = true;
    notifyListeners();
  }

  /// [school] (identifiant de l'école) n'est utile que si la même adresse et le même mot de passe existent dans plusieurs écoles.
  Future<void> login(String email, String password, {String? school}) async {
    final d = await api.post('/auth/login', body: {
      'email': email.trim(),
      'password': password,
      if (school != null && school.isNotEmpty) 'school': school,
    }) as Map;
    api.token = '${d['token']}';
    await TokenStore.write(api.token);
    user = AppUser.fromJson(Map<String, dynamic>.from(d['user'] as Map));
    sessionExpired = false;
    notifyListeners();
  }

  /// Recharge le profil (par exemple après le changement du mot de passe provisoire).
  Future<void> refreshUser() async {
    user = AppUser.fromJson(await api.getMap('/auth/me'));
    notifyListeners();
  }

  Future<void> logout({bool expired = false}) async {
    api.token = null;
    user = null;
    sessionExpired = expired;
    await TokenStore.write(null);
    notifyListeners();
  }
}

class AuthScope extends InheritedNotifier<AuthController> {
  const AuthScope(
      {super.key, required AuthController controller, required super.child})
      : super(notifier: controller);

  static AuthController of(BuildContext context) {
    final s = context.dependOnInheritedWidgetOfExactType<AuthScope>();
    assert(s != null, 'AuthScope manquant');
    return s!.notifier!;
  }
}

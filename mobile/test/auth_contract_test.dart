import 'package:ecole_mobile/core/api_client.dart';
import 'package:ecole_mobile/core/auth_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppUser', () {
    test('mot de passe provisoire : lu depuis le profil renvoyé par le serveur', () {
      final u = AppUser.fromJson({
        'id': 7,
        'email': 'prof@ecole.tn',
        'role': 'enseignant',
        'nom': 'Gharbi',
        'prenom': 'Sami',
        'must_change_password': true,
        'school': {'nom': 'Ecole A'},
      });
      expect(u.mustChangePassword, isTrue);
      expect(u.schoolLabel, 'Ecole A');
    });

    test('sans le champ (ancien serveur) ou à false : aucun changement forcé', () {
      final base = {
        'id': 1,
        'email': 'a@b.tn',
        'role': 'admin',
        'nom': 'N',
        'prenom': 'P',
      };
      expect(AppUser.fromJson(base).mustChangePassword, isFalse);
      expect(AppUser.fromJson({...base, 'must_change_password': false}).mustChangePassword, isFalse);
    });
  });

  group('ApiException', () {
    test('choix d\'école demandé à la connexion', () {
      final e = ApiException(409, 'Cette adresse est utilisée dans plusieurs écoles', {
        'code': 'school_required',
        'ecoles': [
          {'slug': 'ecole-a', 'nom': 'Ecole A'},
          {'slug': 'ecole-b', 'nom': 'Ecole B (Tunis)'},
        ],
      });
      expect(e.needsSchool, isTrue);
      expect(e.ecoles.map((s) => s['slug']), ['ecole-a', 'ecole-b']);
      // un conflit d'emploi du temps n'est pas un choix d'école
      expect(ApiException(409, 'x', {'code': 'conflit_edt'}).needsSchool, isFalse);
      expect(ApiException(401, 'Identifiants incorrects').needsSchool, isFalse);
    });

    test('mot de passe provisoire à changer', () {
      expect(ApiException(403, 'x', {'code': 'password_change_required'}).needsPasswordChange, isTrue);
      expect(ApiException(403, 'Accès refusé').needsPasswordChange, isFalse);
      expect(ApiException(401, 'x', {'code': 'password_change_required'}).needsPasswordChange, isFalse);
    });
  });
}

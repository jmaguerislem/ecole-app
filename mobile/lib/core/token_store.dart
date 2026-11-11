import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Stockage chiffré du jeton de session (Keystore Android).
class TokenStore {
  static const _key = 'session_token';
  static const FlutterSecureStorage _s = FlutterSecureStorage();

  static Future<String?> read() async {
    try {
      return await _s.read(key: _key);
    } catch (_) {
      return null;
    }
  }

  static Future<void> write(String? token) async {
    try {
      if (token == null) {
        await _s.delete(key: _key);
      } else {
        await _s.write(key: _key, value: token);
      }
    } catch (_) {
      // Stockage indisponible : la session ne sera simplement pas mémorisée.
    }
  }
}

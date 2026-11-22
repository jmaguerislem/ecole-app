import 'dart:async';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'notification_hub.dart';
import 'notification_router.dart';

/// Notifications push Firebase (FCM) de l'application.
///
/// - Le jeton de l'appareil est enregistré côté serveur (`POST /push/subscribe`, préfixe « fcm: »), dans la même table que
///   les navigateurs : un utilisateur reçoit donc ses notifications sur le site ET sur le téléphone.
/// - Application fermée / en arrière-plan : Android affiche la notification (charge « notification » envoyée par le serveur).
/// - Application ouverte : bandeau interne + mise à jour de la pastille.
/// - Si Firebase n'est pas configuré (pas de google-services.json), l'application fonctionne normalement sans push.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  static const _storage = FlutterSecureStorage();
  bool _ready = false;
  bool _unavailable = false;
  String? _token;
  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _fgSub;
  StreamSubscription<RemoteMessage>? _openSub;

  /// Identifiant stable de cette installation : le serveur s'en sert pour ne garder qu'UN jeton par appareil
  /// (sinon, après une rotation du jeton, chaque notification arriverait en double).
  Future<String> _deviceId() async {
    try {
      var id = await _storage.read(key: 'device_id');
      if (id == null || id.length < 8) {
        final r = Random.secure();
        id = List.generate(24, (_) => r.nextInt(16).toRadixString(16)).join();
        await _storage.write(key: 'device_id', value: id);
      }
      return id;
    } catch (_) {
      return 'dev${Random().nextInt(1 << 30)}x${DateTime.now().millisecondsSinceEpoch}';
    }
  }

  Future<void> start() async {
    if (_unavailable) return;
    try {
      if (!_ready) {
        await Firebase.initializeApp();
        _ready = true;
      }
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission(); // Android 13+ : autorisation POST_NOTIFICATIONS
      if (perm.authorizationStatus == AuthorizationStatus.denied) return;
      final t = await fm.getToken();
      if (t != null) await _register(t);
      _refreshSub ??= fm.onTokenRefresh.listen(_register);
      _fgSub ??= FirebaseMessaging.onMessage.listen(_onForeground);
      _openSub ??= FirebaseMessaging.onMessageOpenedApp.listen(_onOpened);
      final initial = await fm.getInitialMessage(); // application lancée par un appui sur une notification
      if (initial != null) _onOpened(initial);
    } catch (_) {
      // Firebase non configuré sur ce build : pas de push, le reste de l'application n'est pas affecté.
      _unavailable = !_ready;
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    try {
      await api.post('/push/subscribe', body: {
        'endpoint': 'fcm:$token',
        'keys': {'platform': 'android', 'device': await _deviceId()},
      });
    } on ApiException {
      // Compte sans école (propriétaire) ou serveur injoignable : sera réessayé à la prochaine ouverture.
    }
  }

  /// Déconnexion : l'appareil ne doit plus recevoir les notifications de ce compte.
  /// [authenticated] = faux quand la session est déjà expirée (le serveur refuserait l'appel) :
  /// on invalide alors le jeton localement, ce qui coupe aussi les notifications.
  Future<void> stop({required bool authenticated}) async {
    final t = _token;
    _token = null;
    if (t != null && authenticated) {
      try {
        await api.post('/push/unsubscribe', body: {'endpoint': 'fcm:$t'});
      } catch (_) {}
    }
    if (_ready) {
      try {
        await FirebaseMessaging.instance.deleteToken();
      } catch (_) {}
    }
  }

  void _onForeground(RemoteMessage m) {
    NotificationHub.instance.refresh();
    NotificationRouter.showBanner(
        title: m.notification?.title ?? '',
        body: m.notification?.body ?? '',
        data: m.data);
  }

  void _onOpened(RemoteMessage m) =>
      NotificationRouter.openFromPush(m.data);
}

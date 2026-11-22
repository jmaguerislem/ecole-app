import 'package:flutter/material.dart';

import '../features/shared/annonces_page.dart';
import '../features/shared/messages_page.dart';
import '../features/shared/notifications_page.dart';
import 'api_client.dart';
import 'app_keys.dart';
import 'auth_controller.dart';
import 'notification_hub.dart';
import 'notification_link.dart';

/// Ouvre l'écran visé par une notification (appui sur la liste, sur une notification système ou sur le bandeau).
class NotificationRouter {
  static String? _pending; // appui reçu avant la connexion : exécuté une fois connecté

  static AppUser? get _user {
    final ctx = appNavigatorKey.currentContext;
    if (ctx == null) return null;
    return AuthScope.of(ctx).user;
  }

  static void open(String? lien) {
    final nav = appNavigatorKey.currentState;
    final user = _user;
    if (nav == null || user == null) {
      _pending = lien;
      return;
    }
    final cible = parseLien(lien);
    Widget page;
    switch (cible.type) {
      case LienType.message:
        page = ThreadPage(messageId: cible.id!);
        break;
      case LienType.messagerie:
        page = const MessagesPage();
        break;
      case LienType.annonces:
        page = AnnoncesPage(canPublish: user.role == 'admin');
        break;
      case LienType.notifications:
        page = const NotificationsPage();
        break;
    }
    nav.push(MaterialPageRoute(builder: (_) => page));
  }

  /// Après la connexion : ouvre la notification sur laquelle l'utilisateur avait appuyé.
  static void flushPending() {
    final l = _pending;
    if (l == null || _user == null) return;
    _pending = null;
    open(l);
  }

  /// Appui sur une notification système : marque lue (état partagé avec le site) puis ouvre la page.
  static void openFromPush(Map<String, dynamic> data) {
    final id = int.tryParse('${data['id'] ?? ''}');
    if (id != null && _user != null) {
      api
          .post('/notifications/$id/lu')
          .then((_) => NotificationHub.instance.refresh())
          .catchError((_) {});
    }
    open(data['url']?.toString());
  }

  /// Notification reçue application ouverte : bandeau discret avec bouton « Voir ».
  static void showBanner(
      {required String title,
      required String body,
      required Map<String, dynamic> data}) {
    final m = appMessengerKey.currentState;
    if (m == null || (title.isEmpty && body.isEmpty)) return;
    m.hideCurrentSnackBar();
    m.showSnackBar(SnackBar(
      content: Text(title.isEmpty ? body : '$title\n$body',
          maxLines: 3, overflow: TextOverflow.ellipsis),
      duration: const Duration(seconds: 6),
      action: SnackBarAction(label: 'Voir', onPressed: () => openFromPush(data)),
    ));
  }
}

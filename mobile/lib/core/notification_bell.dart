import 'package:flutter/material.dart';

import '../features/shared/notifications_page.dart';
import 'notification_hub.dart';

/// Cloche de l'en-tête avec pastille de non-lus (équivalent de la cloche du site web).
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: NotificationHub.instance,
      builder: (context, _) {
        final n = NotificationHub.instance.unread;
        return IconButton(
          tooltip: n > 0 ? 'Notifications : $n non lue${n > 1 ? 's' : ''}' : 'Notifications',
          icon: Badge(
            isLabelVisible: n > 0,
            label: Text(n > 99 ? '99+' : '$n'),
            child: const Icon(Icons.notifications_none),
          ),
          onPressed: () async {
            await Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const NotificationsPage()));
            NotificationHub.instance.refresh();
          },
        );
      },
    );
  }
}

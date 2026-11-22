import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/notification_hub.dart';
import '../../core/notification_router.dart';
import '../../core/ui.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await api.post('/notifications/lu-tout');
                NotificationHub.instance.refresh();
                setState(() => _version++);
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            },
            child: const Text('Tout marquer lu'),
          ),
        ],
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_version),
        load: () => api.getList('/notifications'),
        builder: (context, list, reload) {
          if (list.isEmpty) {
            return ScrollPage(children: const [
              EmptyBox(
                  icon: Icons.notifications_none, text: 'Aucune notification.')
            ]);
          }
          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final n = list[i];
              final lu = n['lu'] == true;
              return Card(
                child: ListTile(
                  leading: Icon(
                      lu
                          ? Icons.notifications_none
                          : Icons.notifications_active,
                      color: lu ? Colors.black38 : Colors.indigo),
                  title: Text(str(n['titre']),
                      style: TextStyle(
                          fontWeight: lu ? FontWeight.w500 : FontWeight.w800)),
                  subtitle: Text(
                      '${str(n['corps'])}\n${dateTimeFr(n['created_at'])}'),
                  isThreeLine: true,
                  // Appui : marque lue (état partagé avec le site web) puis ouvre la page concernée
                  onTap: () async {
                    if (!lu) {
                      try {
                        await api.post('/notifications/${n['id']}/lu');
                        NotificationHub.instance.refresh();
                        if (mounted) setState(() => _version++);
                      } catch (_) {}
                    }
                    final lien = n['lien']?.toString();
                    if (lien != null && lien.isNotEmpty) {
                      NotificationRouter.open(lien);
                    }
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}

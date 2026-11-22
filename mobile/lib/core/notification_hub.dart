import 'dart:async';

import 'package:flutter/widgets.dart';

import 'api_client.dart';

/// Nombre de notifications non lues — le MÊME compteur que la cloche du site web (état « lu » stocké sur le serveur).
/// Mis à jour : à l'ouverture, au retour de l'application au premier plan, à la réception d'un push, et toutes les 45 s.
class NotificationHub extends ChangeNotifier with WidgetsBindingObserver {
  NotificationHub._();
  static final NotificationHub instance = NotificationHub._();

  int unread = 0;
  Timer? _timer;
  bool _active = false;

  void start() {
    if (_active) return;
    _active = true;
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 45), (_) => refresh());
    refresh();
  }

  void stop() {
    if (!_active) return;
    _active = false;
    _timer?.cancel();
    _timer = null;
    WidgetsBinding.instance.removeObserver(this);
    if (unread != 0) {
      unread = 0;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    if (!_active) return;
    try {
      final d = await api.getMap('/notifications/count');
      final v = d['non_lues'];
      final n = v is num ? v.toInt() : int.tryParse('$v') ?? 0;
      if (_active && n != unread) {
        unread = n;
        notifyListeners();
      }
    } catch (_) {
      // Réseau indisponible : on garde la dernière valeur connue.
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }
}

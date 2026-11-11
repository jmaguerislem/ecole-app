import 'package:flutter/material.dart';

import '../../core/auth_controller.dart';
import '../shared/account_page.dart';
import 'admin_home_page.dart';
import 'payments_page.dart';
import 'students_page.dart';
import 'timetable_manage_page.dart';

/// Espace administration (et secrétariat/comptable : sans emploi du temps).
class AdminShell extends StatefulWidget {
  final AppUser user;
  const AdminShell({super.key, required this.user});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _index = 0;

  bool get _isAdmin => widget.user.role == 'admin';

  List<({String label, IconData icon, Widget Function() page})> get _tabs => [
        (
          label: 'Accueil',
          icon: Icons.dashboard_outlined,
          page: () => AdminHomePage(isAdmin: _isAdmin, onGo: _goByLabel)
        ),
        (
          label: 'Élèves',
          icon: Icons.groups_outlined,
          page: () => const StudentsPage()
        ),
        if (_isAdmin)
          (
            label: 'Emploi du temps',
            icon: Icons.calendar_month_outlined,
            page: () => const TimetableManagePage()
          ),
        (
          label: 'Paiements',
          icon: Icons.payments_outlined,
          page: () => const PaymentsPage()
        ),
        (
          label: 'Compte',
          icon: Icons.person_outline,
          page: () => AccountPage(user: widget.user)
        ),
      ];

  void _goByLabel(String label) {
    final i = _tabs.indexWhere((t) => t.label == label);
    if (i >= 0) setState(() => _index = i);
  }

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    final i = _index.clamp(0, tabs.length - 1);
    return Scaffold(
      appBar: AppBar(
          title: Text(
              i == 0 ? (widget.user.schoolLabel ?? 'Accueil') : tabs[i].label)),
      body: KeyedSubtree(key: ValueKey(tabs[i].label), child: tabs[i].page()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: i,
        onDestinationSelected: (v) => setState(() => _index = v),
        destinations: [
          for (final t in tabs)
            NavigationDestination(icon: Icon(t.icon), label: t.label)
        ],
      ),
    );
  }
}

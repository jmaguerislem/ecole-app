import 'package:flutter/material.dart';

import '../../core/auth_controller.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'finance_stats_page.dart';
import 'sa_home_page.dart';
import 'schools_page.dart';

/// Espace du propriétaire : le menu latéral contient exactement trois pages.
class SuperAdminShell extends StatefulWidget {
  const SuperAdminShell({super.key});

  @override
  State<SuperAdminShell> createState() => _SuperAdminShellState();
}

class _SuperAdminShellState extends State<SuperAdminShell> {
  int _index = 0;
  static const _titles = ['Accueil', 'Les écoles', 'Statistiques financières'];
  static const _icons = [
    Icons.dashboard_outlined,
    Icons.apartment_outlined,
    Icons.bar_chart_rounded
  ];

  void _go(int i) => setState(() => _index = i);

  Widget _body() {
    switch (_index) {
      case 1:
        return const SchoolsPage();
      case 2:
        return const FinanceStatsPage();
      default:
        return SaHomePage(
            onOpenSchools: () => _go(1), onOpenFinance: () => _go(2));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final u = auth.user!;
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      drawer: Drawer(
        child: SafeArea(
          child: Column(children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
              color: AppColors.brand,
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.school_rounded,
                        color: Colors.white, size: 36),
                    const SizedBox(height: 12),
                    Text(u.fullName,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w700)),
                    Text('${u.roleLabel} · ${u.email}',
                        style: const TextStyle(
                            color: Colors.white70, fontSize: 12)),
                  ]),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < _titles.length; i++)
              ListTile(
                leading: Icon(_icons[i]),
                title: Text(_titles[i],
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                selected: _index == i,
                selectedTileColor: AppColors.brand.withValues(alpha: 0.08),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                onTap: () {
                  Navigator.pop(context);
                  _go(i);
                },
              ),
            const Spacer(),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout, color: AppColors.bad),
              title: const Text('Se déconnecter',
                  style: TextStyle(
                      color: AppColors.bad, fontWeight: FontWeight.w600)),
              onTap: () async {
                if (await confirm(
                    context, 'Déconnexion', 'Voulez-vous vous déconnecter ?',
                    action: 'Se déconnecter')) {
                  await auth.logout();
                }
              },
            ),
          ]),
        ),
      ),
      body: _body(),
    );
  }
}

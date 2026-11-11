import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/auth_controller.dart';
import 'core/env.dart';
import 'core/theme.dart';
import 'features/admin/admin_shell.dart';
import 'features/auth/login_page.dart';
import 'features/family/family_shell.dart';
import 'features/superadmin/superadmin_shell.dart';
import 'features/teacher/teacher_shell.dart';

class EcoleApp extends StatefulWidget {
  const EcoleApp({super.key});

  @override
  State<EcoleApp> createState() => _EcoleAppState();
}

class _EcoleAppState extends State<EcoleApp> {
  final AuthController _auth = AuthController();
  final GlobalKey<NavigatorState> _nav = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    _auth.restore();
    // Déconnexion (volontaire ou session expirée) : on referme toutes les pages ouvertes au-dessus de l'accueil.
    _auth.addListener(() {
      if (_auth.user == null) _nav.currentState?.popUntil((r) => r.isFirst);
    });
  }

  @override
  void dispose() {
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AuthScope(
      controller: _auth,
      child: MaterialApp(
        navigatorKey: _nav,
        title: Env.appName,
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate
        ],
        home: const _AuthGate(),
      ),
    );
  }
}

/// Aiguille l'utilisateur vers l'espace correspondant à son rôle.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    if (!auth.ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final u = auth.user;
    if (u == null) return const LoginPage();
    switch (u.role) {
      case 'superadmin':
        return SuperAdminShell(key: ValueKey('sa${u.id}'));
      case 'admin':
      case 'comptable':
        return AdminShell(key: ValueKey('ad${u.id}'), user: u);
      case 'enseignant':
        return TeacherShell(key: ValueKey('te${u.id}'), user: u);
      case 'parent':
      case 'eleve':
        return FamilyShell(key: ValueKey('fa${u.id}'), user: u);
      default:
        return Scaffold(
          appBar: AppBar(title: const Text('Accès non pris en charge')),
          body: Center(
              child: FilledButton(
                  onPressed: auth.logout, child: const Text('Se déconnecter'))),
        );
    }
  }
}

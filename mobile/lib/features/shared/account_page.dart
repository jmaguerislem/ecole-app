import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/env.dart';
import '../../core/forms.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'annonces_page.dart';
import 'messages_page.dart';
import 'notifications_page.dart';

/// Compte de l'utilisateur : profil, messagerie, annonces, notifications, mot de passe, déconnexion.
class AccountPage extends StatelessWidget {
  final AppUser user;
  const AccountPage({super.key, required this.user});

  @override
  Widget build(BuildContext context) {
    void open(Widget page) =>
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
    return ScrollPage(children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            AvatarCircle(user.initials, size: 56),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user.fullName,
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w800)),
                    Text(user.email,
                        style: const TextStyle(color: Colors.black54)),
                    const SizedBox(height: 6),
                    StatusChip(user.roleLabel, AppColors.brand),
                  ]),
            ),
          ]),
        ),
      ),
      const SizedBox(height: 12),
      Card(
        child: Column(children: [
          ListTile(
              leading: const Icon(Icons.mail_outline),
              title: const Text('Messagerie'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(const MessagesPage())),
          const Divider(height: 1),
          ListTile(
              leading: const Icon(Icons.campaign_outlined),
              title: const Text('Annonces'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () =>
                  open(AnnoncesPage(canPublish: user.role == 'admin'))),
          const Divider(height: 1),
          ListTile(
              leading: const Icon(Icons.notifications_none),
              title: const Text('Notifications'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(const NotificationsPage())),
          const Divider(height: 1),
          ListTile(
              leading: const Icon(Icons.lock_outline),
              title: const Text('Changer mon mot de passe'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () =>
                  showSheet<void>(context, (_) => const _PasswordSheet())),
        ]),
      ),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(foregroundColor: AppColors.bad),
        onPressed: () async {
          if (await confirm(
              context, 'Déconnexion', 'Voulez-vous vous déconnecter ?',
              action: 'Se déconnecter')) {
            await AuthScope.of(context).logout();
          }
        },
        icon: const Icon(Icons.logout),
        label: const Text('Se déconnecter'),
      ),
      const SizedBox(height: 16),
      Center(
          child: Text('${Env.appName} · serveur ${Env.apiUrl}',
              style: const TextStyle(color: Colors.black38, fontSize: 11))),
    ]);
  }
}

class _PasswordSheet extends StatefulWidget {
  const _PasswordSheet();

  @override
  State<_PasswordSheet> createState() => _PasswordSheetState();
}

class _PasswordSheetState extends State<_PasswordSheet> {
  final _form = GlobalKey<FormState>();
  final _old = TextEditingController();
  final _new = TextEditingController();
  final _conf = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _old.dispose();
    _new.dispose();
    _conf.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/auth/change-password', body: {
        'ancien': _old.text,
        'nouveau': _new.text,
        'confirmation': _conf.text
      });
      if (mounted) {
        Navigator.pop(context);
        showOk(context, 'Mot de passe modifié');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Form(
        key: _form,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Changer mon mot de passe',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          textField(_old, 'Mot de passe actuel',
              obscure: true,
              icon: Icons.lock_outline,
              validator: vRequired('Le mot de passe actuel')),
          const SizedBox(height: 12),
          textField(_new, 'Nouveau mot de passe',
              obscure: true,
              icon: Icons.lock_reset,
              helper:
                  '10 caractères minimum avec majuscule, minuscule et chiffre',
              validator: (v) {
            if (v == null || v.length < 10) return '10 caractères minimum';
            if (!RegExp(r'[a-z]').hasMatch(v) ||
                !RegExp(r'[A-Z]').hasMatch(v) ||
                !RegExp(r'\d').hasMatch(v)) {
              return 'Une minuscule, une majuscule et un chiffre';
            }
            return null;
          }),
          const SizedBox(height: 12),
          textField(_conf, 'Confirmer le nouveau mot de passe',
              obscure: true,
              icon: Icons.lock_reset,
              validator: (v) => v != _new.text
                  ? 'Les mots de passe ne correspondent pas'
                  : null),
          const SizedBox(height: 18),
          BusyButton(busy: _busy, onPressed: _save, label: 'Enregistrer'),
        ]),
      ),
    );
  }
}

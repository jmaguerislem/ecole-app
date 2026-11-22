import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/forms.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// Affichée à la place de l'application tant que le mot de passe est provisoire
/// (compte créé par l'administration de l'école : le mot de passe reçu par e-mail doit être remplacé).
/// Le serveur refuse de toute façon toutes les autres requêtes tant que ce n'est pas fait.
class ForcePasswordPage extends StatefulWidget {
  const ForcePasswordPage({super.key});

  @override
  State<ForcePasswordPage> createState() => _ForcePasswordPageState();
}

class _ForcePasswordPageState extends State<ForcePasswordPage> {
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
    final auth = AuthScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await api.post('/auth/change-password', body: {
        'ancien': _old.text,
        'nouveau': _new.text,
        'confirmation': _conf.text
      });
      // Le profil n'est plus « à changer » : l'aiguillage de l'application affiche alors l'espace de l'utilisateur.
      await auth.refreshUser();
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
            content: Text('Mot de passe enregistré. Bienvenue !'),
            backgroundColor: AppColors.ok));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Choisissez votre mot de passe')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                            color: AppColors.warn.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: AppColors.warn.withValues(alpha: 0.4))),
                        child: const Row(children: [
                          Icon(Icons.lock_reset, color: AppColors.warn),
                          SizedBox(width: 10),
                          Expanded(
                              child: Text(
                                  'Votre compte vient d\'être créé avec un mot de passe provisoire. Pour votre sécurité, choisissez dès maintenant votre propre mot de passe.')),
                        ]),
                      ),
                      const SizedBox(height: 20),
                      textField(_old, 'Mot de passe provisoire (reçu par e-mail)',
                          obscure: true,
                          icon: Icons.lock_outline,
                          validator: vRequired('Le mot de passe provisoire')),
                      const SizedBox(height: 12),
                      textField(_new, 'Nouveau mot de passe',
                          obscure: true,
                          icon: Icons.lock_reset,
                          helper:
                              '10 caractères minimum avec majuscule, minuscule et chiffre',
                          validator: (v) {
                        if (v == null || v.length < 10) {
                          return '10 caractères minimum';
                        }
                        if (!RegExp(r'[a-z]').hasMatch(v) ||
                            !RegExp(r'[A-Z]').hasMatch(v) ||
                            !RegExp(r'\d').hasMatch(v)) {
                          return 'Une minuscule, une majuscule et un chiffre';
                        }
                        if (v == _old.text) {
                          return 'Doit être différent du mot de passe provisoire';
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
                      const SizedBox(height: 20),
                      BusyButton(
                          busy: _busy,
                          onPressed: _save,
                          label: 'Enregistrer mon mot de passe'),
                      const SizedBox(height: 8),
                      TextButton(
                          onPressed: _busy ? null : auth.logout,
                          child: const Text('Se déconnecter')),
                    ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/ui.dart';

/// Première connexion d'un parent (code reçu par e-mail) ou mot de passe oublié.
/// Aucun mot de passe n'est jamais envoyé par e-mail : on saisit le code à usage unique puis on choisit son mot de passe.
class ActivatePage extends StatefulWidget {
  final String initialEmail;
  const ActivatePage({super.key, this.initialEmail = ''});

  @override
  State<ActivatePage> createState() => _ActivatePageState();
}

class _ActivatePageState extends State<ActivatePage> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _email =
      TextEditingController(text: widget.initialEmail);
  final _code = TextEditingController();
  final _pw = TextEditingController();
  final _pw2 = TextEditingController();
  bool _busy = false, _sending = false, _hide = true;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _pw.dispose();
    _pw2.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (!_email.text.contains('@')) {
      showError(
          context, ApiException(0, 'Saisissez d\'abord votre adresse e-mail.'));
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await api.post('/auth/forgot-password',
          body: {'email': _email.text.trim()}) as Map;
      if (mounted) showOk(context, '${r['message']}');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String? _pwRule(String? v) {
    if (v == null || v.length < 10) return '10 caractères minimum';
    if (!RegExp(r'[a-z]').hasMatch(v) ||
        !RegExp(r'[A-Z]').hasMatch(v) ||
        !RegExp(r'\d').hasMatch(v))
      return 'Une minuscule, une majuscule et un chiffre';
    return null;
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/auth/set-password', body: {
        'email': _email.text.trim(),
        'code': _code.text.trim(),
        'password': _pw.text,
        'confirmation': _pw2.text,
      });
      if (mounted) Navigator.pop(context, _email.text.trim());
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activer mon compte')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(20), children: [
            const Text(
              'Saisissez l\'adresse e-mail de votre compte et le code reçu par e-mail pour choisir votre mot de passe. Pas de code ou code expiré ? Demandez-en un nouveau.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            ),
            const SizedBox(height: 18),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                  labelText: 'Adresse e-mail (identifiant)',
                  prefixIcon: Icon(Icons.mail_outline)),
              validator: (v) => (v == null || !v.contains('@'))
                  ? 'Adresse e-mail invalide'
                  : null,
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                  onPressed: _sending ? null : _sendCode,
                  icon: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send_outlined, size: 18),
                  label: const Text('Recevoir un nouveau code')),
            ),
            const SizedBox(height: 6),
            TextFormField(
              controller: _code,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                  labelText: 'Code d\'activation (ex. AB12C-D3EFG)',
                  prefixIcon: Icon(Icons.vpn_key_outlined)),
              validator: (v) => (v == null ||
                      v.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').length < 10)
                  ? 'Le code comporte 10 caractères'
                  : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _pw,
              obscureText: _hide,
              decoration: InputDecoration(
                labelText: 'Nouveau mot de passe',
                prefixIcon: const Icon(Icons.lock_outline),
                helperText:
                    '10 caractères minimum, avec majuscule, minuscule et chiffre',
                suffixIcon: IconButton(
                    icon: Icon(_hide
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined),
                    onPressed: () => setState(() => _hide = !_hide)),
              ),
              validator: _pwRule,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _pw2,
              obscureText: _hide,
              decoration: const InputDecoration(
                  labelText: 'Confirmer le mot de passe',
                  prefixIcon: Icon(Icons.lock_outline)),
              validator: (v) => v != _pw.text
                  ? 'Les mots de passe ne correspondent pas'
                  : null,
            ),
            const SizedBox(height: 22),
            BusyButton(
                busy: _busy,
                onPressed: _submit,
                label: 'Définir mon mot de passe'),
          ]),
        ),
      ),
    );
  }
}

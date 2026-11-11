import 'package:flutter/material.dart';

import '../../core/auth_controller.dart';
import '../../core/env.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'activate_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthScope.of(context).login(_email.text, _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _activate() async {
    final email = await Navigator.of(context).push<String>(MaterialPageRoute(
        builder: (_) => ActivatePage(initialEmail: _email.text)));
    if (email != null && mounted) {
      _email.text = email;
      _password.clear();
      showOk(context, 'Mot de passe défini. Vous pouvez vous connecter.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final expired = AuthScope.of(context).sessionExpired;
    return Scaffold(
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
                      Center(
                        child: Container(
                          width: 84,
                          height: 84,
                          decoration: BoxDecoration(
                              color: AppColors.brand,
                              borderRadius: BorderRadius.circular(24)),
                          child: const Icon(Icons.school_rounded,
                              color: Colors.white, size: 46),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(Env.appName,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 30,
                              fontWeight: FontWeight.w800,
                              color: AppColors.brand)),
                      const SizedBox(height: 4),
                      const Text('Connectez-vous à votre espace',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.black54)),
                      const SizedBox(height: 28),
                      if (expired && _error == null)
                        _banner('Votre session a expiré. Reconnectez-vous.',
                            AppColors.warn),
                      if (_error != null) _banner(_error!, AppColors.bad),
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                            labelText: 'Adresse e-mail',
                            prefixIcon: Icon(Icons.mail_outline)),
                        validator: (v) => (v == null || !v.contains('@'))
                            ? 'Saisissez une adresse e-mail valide'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        obscureText: _hide,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Mot de passe',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                              icon: Icon(_hide
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined),
                              onPressed: () => setState(() => _hide = !_hide)),
                        ),
                        validator: (v) => (v == null || v.isEmpty)
                            ? 'Saisissez votre mot de passe'
                            : null,
                      ),
                      const SizedBox(height: 20),
                      BusyButton(
                          busy: _busy,
                          onPressed: _submit,
                          label: 'Se connecter'),
                      const SizedBox(height: 8),
                      TextButton(
                          onPressed: _activate,
                          child: const Text(
                              'Première connexion / mot de passe oublié')),
                    ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _banner(String text, Color c) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: c.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: c.withValues(alpha: 0.4))),
        child: Row(children: [
          Icon(Icons.info_outline, color: c, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text))
        ]),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/json.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/ui.dart';
import 'sa_common.dart';

/// Ajout ou modification d'une école (school == null : création).
class SchoolFormPage extends StatefulWidget {
  final Map<String, dynamic>? school;
  const SchoolFormPage({super.key, this.school});

  @override
  State<SchoolFormPage> createState() => _SchoolFormPageState();
}

class _SchoolFormPageState extends State<SchoolFormPage> {
  final _form = GlobalKey<FormState>();
  bool get _edit => widget.school != null;
  late final Map<String, dynamic> _s = widget.school ?? {};

  late final _nom = TextEditingController(text: str0(_s['nom']));
  late final _ville = TextEditingController(text: str0(_s['ville']));
  late final _adresse = TextEditingController(text: str0(_s['adresse']));
  late final _tel = TextEditingController(text: str0(_s['telephone']));
  late final _mail = TextEditingController(text: str0(_s['email_contact']));
  late final _site = TextEditingController(text: str0(_s['site']));
  final _admNom = TextEditingController(text: 'Direction');
  final _admPrenom = TextEditingController();
  final _admMail = TextEditingController();
  final _admPw = TextEditingController();
  final _loyer = TextEditingController();
  final _jour = TextEditingController(text: '5');
  late String _plan =
      planLabels.containsKey('${_s['plan']}') ? '${_s['plan']}' : 'basic';
  late String _status = '${_s['status']}' == 'trial' ? 'trial' : 'active';
  String? _fin;
  String? _debut;
  bool _avecContrat = false;
  bool _busy = false;

  static String str0(dynamic v) => str(v);

  @override
  void initState() {
    super.initState();
    final f = _s['subscription_end'];
    if (f != null && '$f'.length >= 10) _fin = '$f'.substring(0, 10);
  }

  @override
  void dispose() {
    for (final c in [
      _nom,
      _ville,
      _adresse,
      _tel,
      _mail,
      _site,
      _admNom,
      _admPrenom,
      _admMail,
      _admPw,
      _loyer,
      _jour
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_avecContrat && _debut == null) {
      showError(
          context, ApiException(0, 'Choisissez la date de début du contrat.'));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        'nom': _nom.text.trim(),
        'ville': _ville.text.trim(),
        'adresse': orNull(_adresse),
        'telephone': orNull(_tel),
        'email_contact': orNull(_mail),
        'site': orNull(_site),
        'plan': _plan,
        'subscription_end': _fin,
      };
      if (_edit) {
        await api.put('/saas/schools/${_s['id']}', body: body);
        if (mounted) {
          showOk(context, 'École modifiée');
          Navigator.pop(context, true);
        }
        return;
      }
      body['status'] = _status;
      body['admin'] = {
        'nom': _admNom.text.trim(),
        'prenom': _admPrenom.text.trim(),
        'email': _admMail.text.trim(),
        if (_admPw.text.isNotEmpty) 'password': _admPw.text,
      };
      if (_avecContrat) {
        body['contrat'] = {
          'loyer_mensuel': parseDecimal(_loyer.text),
          'jour_echeance': int.tryParse(_jour.text) ?? 5,
          'date_debut': _debut
        };
      }
      final r = asMapSafe(await api.post('/saas/schools', body: body));
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (c) => AlertDialog(
          title: const Text('École créée'),
          content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Compte de direction : ${r['admin_email']}'),
                if (r['mot_de_passe_initial'] != null) ...[
                  const SizedBox(height: 10),
                  const Text(
                      'Mot de passe initial (affiché une seule fois, à transmettre à la direction) :'),
                  const SizedBox(height: 6),
                  SelectableText('${r['mot_de_passe_initial']}',
                      style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 18,
                          fontWeight: FontWeight.w700)),
                ],
                if (r['contrat_erreur'] != null) ...[
                  const SizedBox(height: 10),
                  Text(
                      'Le contrat n\'a pas pu être enregistré : ${r['contrat_erreur']}\nVous pouvez le définir depuis la fiche de l\'école.',
                      style: const TextStyle(color: Colors.red)),
                ],
              ]),
          actions: [
            if (r['mot_de_passe_initial'] != null)
              TextButton(
                  onPressed: () => Clipboard.setData(
                      ClipboardData(text: '${r['mot_de_passe_initial']}')),
                  child: const Text('Copier')),
            FilledButton(
                onPressed: () => Navigator.pop(c),
                child: const Text('Terminer')),
          ],
        ),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> asMapSafe(dynamic v) =>
      v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar:
          AppBar(title: Text(_edit ? 'Modifier l\'école' : 'Nouvelle école')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            _title('Établissement'),
            textField(_nom, 'Nom de l\'école *',
                validator: vRequired('Le nom', min: 2),
                capitalization: TextCapitalization.words,
                icon: Icons.apartment),
            const SizedBox(height: 12),
            textField(_ville, 'Ville *',
                validator: vRequired('La ville', min: 2),
                capitalization: TextCapitalization.words,
                icon: Icons.location_city),
            const SizedBox(height: 12),
            textField(_adresse, 'Adresse', icon: Icons.place_outlined),
            const SizedBox(height: 12),
            textField(_tel, 'Téléphone (8 chiffres)',
                keyboard: TextInputType.phone,
                validator: vPhone8,
                icon: Icons.phone_outlined,
                formatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9 .-]'))
                ]),
            const SizedBox(height: 12),
            textField(_mail, 'E-mail de contact',
                keyboard: TextInputType.emailAddress,
                validator: (v) => vEmail(v, required: false),
                icon: Icons.mail_outline),
            const SizedBox(height: 12),
            textField(_site, 'Site / bâtiment (facultatif)',
                icon: Icons.domain,
                helper:
                    'Deux écoles ayant le même site partagent leurs locaux : une même salle ne peut pas être réservée en même temps par les deux.'),
            const SizedBox(height: 12),
            dropdown<String>(
                label: 'Formule',
                value: _plan,
                items: planLabels,
                onChanged: (v) => setState(() => _plan = v ?? 'basic'),
                icon: Icons.workspace_premium_outlined),
            const SizedBox(height: 12),
            if (!_edit) ...[
              dropdown<String>(
                  label: 'Statut initial',
                  value: _status,
                  items: const {
                    'trial': 'Période d\'essai',
                    'active': 'Active'
                  },
                  onChanged: (v) => setState(() => _status = v ?? 'active'),
                  icon: Icons.toggle_on_outlined),
              const SizedBox(height: 12),
            ],
            PickerField(
              label: 'Fin d\'abonnement (facultatif)',
              value: _fin == null ? null : dateFrShort(_fin!),
              onTap: () async {
                final d = await pickDate(context, initial: _fin);
                if (d != null) setState(() => _fin = d);
              },
            ),
            if (_fin != null)
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                      onPressed: () => setState(() => _fin = null),
                      child: const Text('Retirer la date'))),
            if (!_edit) ...[
              const SizedBox(height: 20),
              _title('Compte de la direction'),
              textField(_admPrenom, 'Prénom *',
                  validator: vRequired('Le prénom', min: 2),
                  capitalization: TextCapitalization.words,
                  icon: Icons.person_outline),
              const SizedBox(height: 12),
              textField(_admNom, 'Nom *',
                  validator: vRequired('Le nom', min: 2),
                  capitalization: TextCapitalization.words,
                  icon: Icons.person_outline),
              const SizedBox(height: 12),
              textField(_admMail, 'E-mail (identifiant) *',
                  keyboard: TextInputType.emailAddress,
                  validator: vEmail,
                  icon: Icons.mail_outline),
              const SizedBox(height: 12),
              textField(
                  _admPw, 'Mot de passe (laisser vide pour en générer un)',
                  obscure: true,
                  icon: Icons.lock_outline,
                  helper:
                      '10 caractères minimum avec majuscule, minuscule et chiffre'),
              const SizedBox(height: 20),
              SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Définir le contrat de location maintenant',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                  value: _avecContrat,
                  onChanged: (v) => setState(() => _avecContrat = v)),
              if (_avecContrat) ...[
                textField(_loyer, 'Loyer mensuel (TND) *',
                    keyboard:
                        const TextInputType.numberWithOptions(decimal: true),
                    validator: _avecContrat ? vMoney('Le loyer') : null,
                    icon: Icons.payments_outlined),
                const SizedBox(height: 12),
                textField(_jour, 'Jour d\'échéance (1 à 28)',
                    keyboard: TextInputType.number, validator: (v) {
                  final n = int.tryParse((v ?? '').trim());
                  return (n == null || n < 1 || n > 28)
                      ? 'Entre 1 et 28'
                      : null;
                }, icon: Icons.event),
                const SizedBox(height: 12),
                PickerField(
                  label: 'Début du contrat *',
                  value: _debut == null ? null : dateFrShort(_debut!),
                  onTap: () async {
                    final d = await pickDate(context, initial: _debut);
                    if (d != null) setState(() => _debut = d);
                  },
                ),
              ],
            ],
            const SizedBox(height: 24),
            BusyButton(
                busy: _busy,
                onPressed: _save,
                label: _edit ? 'Enregistrer' : 'Créer l\'école'),
          ]),
        ),
      ),
    );
  }

  Widget _title(String t) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(t,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)));
  static String dateFrShort(String iso) =>
      '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// Ajout / modification d'un élève.
/// À la création : le compte du parent est créé automatiquement (ou le compte existant est réutilisé : aucun doublon)
/// puis un e-mail d'activation (sans mot de passe en clair) lui est envoyé.
class StudentFormPage extends StatefulWidget {
  final Map<String, dynamic>? eleve;
  const StudentFormPage({super.key, this.eleve});

  @override
  State<StudentFormPage> createState() => _StudentFormPageState();
}

class _StudentFormPageState extends State<StudentFormPage> {
  final _form = GlobalKey<FormState>();
  bool get _edit => widget.eleve != null;
  late final Map<String, dynamic> _e = widget.eleve ?? {};

  late final _nom = TextEditingController(text: str(_e['nom']));
  late final _prenom = TextEditingController(text: str(_e['prenom']));
  late final _matricule = TextEditingController(text: str(_e['matricule']));
  late final _adresse = TextEditingController(text: str(_e['adresse']));
  final _pw = TextEditingController();
  final _pw2 = TextEditingController();
  final _pNom = TextEditingController();
  final _pPrenom = TextEditingController();
  final _pMail = TextEditingController();
  final _pTel = TextEditingController();
  String? _naissance;
  String? _sexe;
  int? _classe;
  String _statut = 'actif';
  bool _busy = false;
  List<Map<String, dynamic>> _classes = [];
  bool _loaded = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    if (_e['date_naissance'] != null) {
      _naissance = '${_e['date_naissance']}'.substring(0, 10);
    }
    _sexe = _e['sexe'] == null ? null : '${_e['sexe']}';
    _classe = _e['classe_id'] == null ? null : toNumInt(_e['classe_id']);
    _statut = _e['statut'] == null ? 'actif' : '${_e['statut']}';
    _loadClasses();
  }

  static int toNumInt(dynamic v) => int.tryParse('$v') ?? 0;

  Future<void> _loadClasses() async {
    try {
      final c = await api.getList('/classes');
      if (mounted) {
        setState(() {
          _classes = c;
          _loaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadError = errorText(e);
          _loaded = true;
        });
      }
    }
  }

  @override
  void dispose() {
    for (final c in [
      _nom,
      _prenom,
      _matricule,
      _adresse,
      _pw,
      _pw2,
      _pNom,
      _pPrenom,
      _pMail,
      _pTel
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _pwRule(String? v) {
    if (v == null || v.length < 10) return '10 caractères minimum';
    if (!RegExp(r'[a-z]').hasMatch(v) ||
        !RegExp(r'[A-Z]').hasMatch(v) ||
        !RegExp(r'\d').hasMatch(v)) {
      return 'Une minuscule, une majuscule et un chiffre';
    }
    return null;
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_naissance == null) {
      showError(context, ApiException(0, 'Choisissez la date de naissance.'));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        'nom': _nom.text.trim(),
        'prenom': _prenom.text.trim(),
        'date_naissance': _naissance,
        'sexe': _sexe,
        'classe_id': _classe,
        'matricule': orNull(_matricule),
        'adresse': orNull(_adresse),
        'statut': _statut,
      };
      if (!_edit) {
        body['password'] = _pw.text;
        body['password_confirm'] = _pw2.text;
      }
      if (_pMail.text.trim().isNotEmpty) {
        body['parent'] = {
          'nom': _pNom.text.trim(),
          'prenom': _pPrenom.text.trim(),
          'email': _pMail.text.trim(),
          if (_pTel.text.trim().isNotEmpty)
            'telephone': _pTel.text.replaceAll(RegExp(r'[\s.-]'), '')
        };
      }
      final r = asMap(_edit
          ? await api.put('/eleves/${_e['id']}', body: body)
          : await api.post('/eleves', body: body));
      if (!mounted) return;
      final inv = r['invitation'] == null ? null : asMap(r['invitation']);
      if (inv != null) {
        await _showInvitationResult(inv, r);
      } else {
        showOk(context, _edit ? 'Élève modifié' : 'Élève enregistré');
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showInvitationResult(
      Map<String, dynamic> inv, Map<String, dynamic> eleve) {
    final sent = inv['email_envoye'] == true;
    final created = inv['compte_cree'] == true;
    return showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        icon: Icon(
            sent ? Icons.mark_email_read_outlined : Icons.warning_amber_rounded,
            color: sent ? AppColors.ok : AppColors.warn,
            size: 40),
        title: Text(
            sent ? 'Élève enregistré' : 'Élève enregistré, e-mail non envoyé'),
        content: Text(
          sent
              ? (created
                  ? 'Le compte parent a été créé et un e-mail d\'activation a été envoyé à ${_pMail.text.trim()}. Il contient un code à usage unique : aucun mot de passe n\'est transmis.'
                  : 'Le parent a déjà un compte : ${eleve['prenom']} a été rattaché(e) à ce compte et le parent a été prévenu par e-mail.')
              : 'L\'inscription est bien enregistrée et le compte parent existe, mais l\'e-mail n\'a pas pu être envoyé (${inv['erreur'] ?? 'erreur inconnue'}).\n\nVous pourrez le renvoyer depuis la fiche de l\'élève, rubrique « Parents ».',
        ),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(c), child: const Text('OK'))
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_edit ? 'Modifier l\'élève' : 'Nouvel élève')),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Form(
                key: _form,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (_loadError != null)
                    Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text('Classes indisponibles : $_loadError',
                            style: const TextStyle(color: AppColors.bad))),
                  _title('Élève'),
                  textField(_prenom, 'Prénom *',
                      validator: vRequired('Le prénom', min: 2),
                      capitalization: TextCapitalization.words,
                      icon: Icons.person_outline),
                  const SizedBox(height: 12),
                  textField(_nom, 'Nom *',
                      validator: vRequired('Le nom', min: 2),
                      capitalization: TextCapitalization.words,
                      icon: Icons.person_outline),
                  const SizedBox(height: 12),
                  PickerField(
                    label: 'Date de naissance *',
                    value: _naissance == null
                        ? null
                        : '${_naissance!.substring(8, 10)}/${_naissance!.substring(5, 7)}/${_naissance!.substring(0, 4)}',
                    onTap: () async {
                      final d = await pickDate(context,
                          initial: _naissance ?? '2018-01-01',
                          first: DateTime(DateTime.now().year - 25),
                          last: DateTime.now());
                      if (d != null) setState(() => _naissance = d);
                    },
                  ),
                  const SizedBox(height: 12),
                  dropdown<String?>(
                      label: 'Sexe',
                      value: _sexe,
                      items: const {
                        null: 'Non précisé',
                        'M': 'Garçon',
                        'F': 'Fille'
                      },
                      onChanged: (v) => setState(() => _sexe = v)),
                  const SizedBox(height: 12),
                  dropdown<int?>(
                    label: 'Classe',
                    icon: Icons.class_outlined,
                    value: _classe,
                    items: {
                      null: 'Sans classe',
                      for (final c in _classes) toNumInt(c['id']): '${c['nom']}'
                    },
                    onChanged: (v) => setState(() => _classe = v),
                  ),
                  const SizedBox(height: 12),
                  textField(_matricule, 'Matricule (facultatif)',
                      icon: Icons.badge_outlined,
                      capitalization: TextCapitalization.characters),
                  const SizedBox(height: 12),
                  textField(_adresse, 'Adresse', icon: Icons.place_outlined),
                  if (_edit) ...[
                    const SizedBox(height: 12),
                    dropdown<String>(
                        label: 'Statut',
                        value: _statut,
                        items: const {
                          'actif': 'Actif',
                          'inactif': 'Inactif',
                          'diplome': 'Diplômé'
                        },
                        onChanged: (v) =>
                            setState(() => _statut = v ?? 'actif')),
                  ],
                  if (!_edit) ...[
                    const SizedBox(height: 22),
                    _title('Accès de l\'élève'),
                    textField(_pw, 'Mot de passe du compte élève *',
                        obscure: true,
                        validator: _pwRule,
                        icon: Icons.lock_outline,
                        helper:
                            '10 caractères minimum avec majuscule, minuscule et chiffre'),
                    const SizedBox(height: 12),
                    textField(_pw2, 'Confirmer le mot de passe *',
                        obscure: true,
                        validator: (v) => v != _pw.text
                            ? 'Les mots de passe ne correspondent pas'
                            : null,
                        icon: Icons.lock_outline),
                  ],
                  const SizedBox(height: 22),
                  _title(_edit ? 'Ajouter un parent' : 'Parent / tuteur'),
                  Container(
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                        color: AppColors.info.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(12)),
                    child: const Text(
                      'Si vous renseignez l\'e-mail du parent : son compte est créé automatiquement (ou retrouvé s\'il existe déjà, pour regrouper ses enfants) et il reçoit un e-mail d\'activation sans mot de passe en clair.',
                      style: TextStyle(fontSize: 13, height: 1.35),
                    ),
                  ),
                  textField(_pMail, 'E-mail du parent${_edit ? '' : ' *'}',
                      keyboard: TextInputType.emailAddress,
                      icon: Icons.mail_outline, validator: (v) {
                    if (_edit && (v ?? '').trim().isEmpty) return null;
                    return vEmail(v);
                  }),
                  const SizedBox(height: 12),
                  textField(_pPrenom, 'Prénom du parent',
                      capitalization: TextCapitalization.words,
                      icon: Icons.person_outline,
                      validator: (v) => _parentRequired()
                          ? vRequired('Le prénom du parent', min: 2)(v)
                          : null),
                  const SizedBox(height: 12),
                  textField(_pNom, 'Nom du parent',
                      capitalization: TextCapitalization.words,
                      icon: Icons.person_outline,
                      validator: (v) => _parentRequired()
                          ? vRequired('Le nom du parent', min: 2)(v)
                          : null),
                  const SizedBox(height: 12),
                  textField(_pTel, 'Téléphone du parent (8 chiffres)',
                      keyboard: TextInputType.phone,
                      icon: Icons.phone_outlined,
                      validator: vPhone8,
                      formatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9 .-]'))
                      ]),
                  const SizedBox(height: 24),
                  BusyButton(
                      busy: _busy,
                      onPressed: _save,
                      label: _edit ? 'Enregistrer' : 'Enregistrer l\'élève'),
                ]),
              ),
            ),
    );
  }

  bool _parentRequired() => _pMail.text.trim().isNotEmpty;

  Widget _title(String t) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(t,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)));
}

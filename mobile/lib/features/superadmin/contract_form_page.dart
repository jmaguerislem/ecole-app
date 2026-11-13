import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/json.dart';
import '../../core/ui.dart';

/// Définition / modification du contrat de location d'une école.
class ContractFormPage extends StatefulWidget {
  final int schoolId;
  final Map<String, dynamic>? contrat;
  const ContractFormPage({super.key, required this.schoolId, this.contrat});

  @override
  State<ContractFormPage> createState() => _ContractFormPageState();
}

class _ContractFormPageState extends State<ContractFormPage> {
  final _form = GlobalKey<FormState>();
  late final Map<String, dynamic> _c = widget.contrat ?? {};
  late final _loyer = TextEditingController(
      text: _c['loyer_mensuel'] == null ? '' : '${_c['loyer_mensuel']}');
  late final _jour = TextEditingController(text: '${_c['jour_echeance'] ?? 5}');
  late final _caution = TextEditingController(
      text: _c['caution'] == null ? '' : '${_c['caution']}');
  late final _notes = TextEditingController(text: str(_c['notes']));
  String? _debut, _fin;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (_c['date_debut'] != null) {
      _debut = '${_c['date_debut']}'.substring(0, 10);
    }
    if (_c['date_fin'] != null) _fin = '${_c['date_fin']}'.substring(0, 10);
  }

  @override
  void dispose() {
    _loyer.dispose();
    _jour.dispose();
    _caution.dispose();
    _notes.dispose();
    super.dispose();
  }

  String _fr(String iso) =>
      '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_debut == null) {
      showError(
          context, ApiException(0, 'Choisissez la date de début du contrat.'));
      return;
    }
    if (_fin != null && _fin!.compareTo(_debut!) < 0) {
      showError(context,
          ApiException(0, 'La date de fin doit suivre la date de début.'));
      return;
    }
    setState(() => _busy = true);
    try {
      await api.put('/saas/schools/${widget.schoolId}/contrat', body: {
        'loyer_mensuel': parseDecimal(_loyer.text),
        'jour_echeance': int.parse(_jour.text.trim()),
        'date_debut': _debut,
        'date_fin': _fin,
        'caution': parseDecimal(_caution.text),
        'notes': orNull(_notes),
      });
      if (mounted) {
        showOk(context, 'Contrat enregistré');
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          title: Text(widget.contrat == null
              ? 'Contrat de location'
              : 'Modifier le contrat')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            textField(_loyer, 'Loyer mensuel (TND) *',
                keyboard: const TextInputType.numberWithOptions(decimal: true),
                validator: vMoney('Le loyer', max: 1000000),
                icon: Icons.payments_outlined),
            const SizedBox(height: 12),
            textField(_jour, 'Jour d\'échéance chaque mois (1 à 28) *',
                keyboard: TextInputType.number,
                icon: Icons.event, validator: (v) {
              final n = int.tryParse((v ?? '').trim());
              return (n == null || n < 1 || n > 28)
                  ? 'Saisissez un jour entre 1 et 28'
                  : null;
            }),
            const SizedBox(height: 12),
            PickerField(
              label: 'Début du contrat *',
              value: _debut == null ? null : _fr(_debut!),
              onTap: () async {
                final d = await pickDate(context,
                    initial: _debut,
                    first: DateTime(2015),
                    last: DateTime(DateTime.now().year + 15));
                if (d != null) setState(() => _debut = d);
              },
            ),
            const SizedBox(height: 12),
            PickerField(
              label: 'Fin du contrat (vide = durée indéterminée)',
              value: _fin == null ? null : _fr(_fin!),
              onTap: () async {
                final d = await pickDate(context,
                    initial: _fin ?? _debut,
                    first: DateTime(2015),
                    last: DateTime(DateTime.now().year + 30));
                if (d != null) setState(() => _fin = d);
              },
            ),
            if (_fin != null)
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                      onPressed: () => setState(() => _fin = null),
                      child: const Text('Retirer la date de fin'))),
            const SizedBox(height: 12),
            textField(_caution, 'Caution (TND)',
                keyboard: const TextInputType.numberWithOptions(decimal: true),
                validator: vMoney('La caution', required: false),
                icon: Icons.shield_outlined),
            const SizedBox(height: 12),
            textField(_notes, 'Notes',
                maxLines: 3, maxLength: 1000, icon: Icons.notes),
            const SizedBox(height: 16),
            const Text(
                'Les échéances mensuelles sont générées automatiquement sur la durée du contrat (12 mois à l\'avance si la durée est indéterminée).',
                style: TextStyle(color: Colors.black54, fontSize: 12.5)),
            const SizedBox(height: 20),
            BusyButton(
                busy: _busy, onPressed: _save, label: 'Enregistrer le contrat'),
          ]),
        ),
      ),
    );
  }
}

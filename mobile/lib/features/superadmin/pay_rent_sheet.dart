import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/ui.dart';
import 'sa_common.dart';

/// Enregistrement d'un encaissement de loyer (seul un encaissement devient un revenu).
class PayRentSheet extends StatefulWidget {
  final Map<String, dynamic> echeance;
  final String ecole;
  const PayRentSheet({super.key, required this.echeance, required this.ecole});

  @override
  State<PayRentSheet> createState() => _PayRentSheetState();
}

class _PayRentSheetState extends State<PayRentSheet> {
  final _form = GlobalKey<FormState>();
  late final _montant = TextEditingController(
      text: toNum(widget.echeance['reste']).toStringAsFixed(2));
  final _ref = TextEditingController();
  final _notes = TextEditingController();
  String _mode = 'especes';
  String _date = isoDate(DateTime.now());
  bool _busy = false;

  @override
  void dispose() {
    _montant.dispose();
    _ref.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/saas/echeances/${widget.echeance['id']}/encaissements',
          body: {
            'montant': parseDecimal(_montant.text),
            'date_paiement': _date,
            'mode': _mode,
            'reference': orNull(_ref),
            'notes': orNull(_notes),
          });
      if (mounted) {
        showOk(context, 'Encaissement enregistré');
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
    final reste = toNum(widget.echeance['reste']);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Form(
        key: _form,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Encaisser le loyer de ${moisAnnee(widget.echeance['periode'])}',
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('${widget.ecole} · reste à payer : ${money(reste)}',
              style: const TextStyle(color: Colors.black54)),
          const SizedBox(height: 16),
          textField(_montant, 'Montant encaissé (TND) *',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
              icon: Icons.payments_outlined, validator: (v) {
            final base = vMoney('Le montant', min: 0.01)(v);
            if (base != null) return base;
            return parseDecimal(v!)! > reste + 0.0001
                ? 'Dépasse le reste à payer (${money(reste)})'
                : null;
          }),
          const SizedBox(height: 12),
          PickerField(
            label: 'Date du paiement *',
            value: dateFr(_date),
            onTap: () async {
              final d =
                  await pickDate(context, initial: _date, last: DateTime.now());
              if (d != null) setState(() => _date = d);
            },
          ),
          const SizedBox(height: 12),
          dropdown<String>(
              label: 'Mode de paiement *',
              value: _mode,
              items: modeLabels,
              onChanged: (v) => setState(() => _mode = v ?? 'especes'),
              icon: Icons.account_balance_wallet_outlined),
          const SizedBox(height: 12),
          textField(
              _ref,
              _mode == 'especes'
                  ? 'Référence (facultatif)'
                  : 'Référence (n° de chèque, de virement…) *',
              icon: Icons.tag,
              validator: (v) => _mode != 'especes' && (v ?? '').trim().isEmpty
                  ? 'La référence est obligatoire pour ce mode'
                  : null),
          const SizedBox(height: 12),
          textField(_notes, 'Notes', maxLines: 2, icon: Icons.notes),
          const SizedBox(height: 18),
          BusyButton(
              busy: _busy,
              onPressed: _save,
              label: 'Enregistrer l\'encaissement',
              icon: Icons.check),
        ]),
      ),
    );
  }
}

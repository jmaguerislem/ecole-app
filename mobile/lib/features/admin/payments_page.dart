import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../shared/pickers.dart';

const _modes = {
  'especes': 'Espèces',
  'virement': 'Virement',
  'mobile_money': 'Mobile money'
};

/// Paiements de scolarité (liste + enregistrement).
class PaymentsPage extends StatefulWidget {
  const PaymentsPage({super.key});

  @override
  State<PaymentsPage> createState() => _PaymentsPageState();
}

class _PaymentsPageState extends State<PaymentsPage> {
  int _version = 0;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok =
              await showSheet<bool>(context, (_) => const _PaymentSheet());
          if (ok == true) setState(() => _version++);
        },
        icon: const Icon(Icons.add_card),
        label: const Text('Nouveau paiement'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
              decoration: const InputDecoration(
                  hintText: 'Rechercher (élève, n° de reçu)',
                  prefixIcon: Icon(Icons.search)),
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase())),
        ),
        Expanded(
          child: AsyncView<List<Map<String, dynamic>>>(
            key: ValueKey(_version),
            load: () => api.getList('/paiements'),
            builder: (context, all, reload) {
              final list = all
                  .where((p) =>
                      _q.isEmpty ||
                      '${p['eleve_nom']} ${p['numero_recu'] ?? ''} ${p['reference'] ?? ''}'
                          .toLowerCase()
                          .contains(_q))
                  .toList();
              if (list.isEmpty) {
                return ScrollPage(children: [
                  EmptyBox(
                      icon: Icons.payments_outlined,
                      text: all.isEmpty
                          ? 'Aucun paiement enregistré.'
                          : 'Aucun résultat.')
                ]);
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final p = list[i];
                  return Card(
                    child: ListTile(
                      leading: const CircleAvatar(
                          backgroundColor: Color(0x1A1E8E5A),
                          child: Icon(Icons.check, color: AppColors.ok)),
                      title: Text('${p['eleve_nom']}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(
                          '${str(p['numero_recu'])} · ${_modes['${p['mode']}'] ?? p['mode']}\n${dateFr(p['date_paiement'])}${str(p['tarif_libelle']).isEmpty ? '' : ' · ${p['tarif_libelle']}'}'),
                      isThreeLine: true,
                      trailing: Text(money(p['montant']),
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              color: AppColors.ok)),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _PaymentSheet extends StatefulWidget {
  const _PaymentSheet();

  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  final _form = GlobalKey<FormState>();
  final _montant = TextEditingController();
  final _ref = TextEditingController();
  Map<String, dynamic>? _eleve;
  Map<String, dynamic>? _solde;
  String _mode = 'especes';
  String _date = isoDate(DateTime.now());
  bool _busy = false;

  @override
  void dispose() {
    _montant.dispose();
    _ref.dispose();
    super.dispose();
  }

  Future<void> _chooseStudent() async {
    try {
      final list = await api.getList('/eleves', query: {'statut': 'actif'});
      if (!mounted) return;
      final e = await pickFromList(context,
          title: 'Choisir un élève',
          items: list,
          label: (e) => '${e['nom']} ${e['prenom']}',
          subtitle: (e) => str(e['classe_nom']));
      if (e == null) return;
      setState(() {
        _eleve = e;
        _solde = null;
      });
      try {
        final s = await api.getMap('/paiements/solde/${e['id']}');
        if (mounted) setState(() => _solde = s);
      } catch (_) {}
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _save() async {
    if (_eleve == null) {
      showError(context, ApiException(0, 'Choisissez un élève.'));
      return;
    }
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = asMap(await api.post('/paiements', body: {
        'eleve_id': _eleve!['id'],
        'montant': parseDecimal(_montant.text),
        'mode': _mode,
        'date_paiement': _date,
        'reference': orNull(_ref)
      }));
      if (mounted) {
        showOk(context,
            'Paiement enregistré${str(r['numero_recu']).isEmpty ? '' : ' · reçu ${r['numero_recu']}'}');
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
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Form(
        key: _form,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Nouveau paiement',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: _chooseStudent,
            child: InputDecorator(
              decoration: const InputDecoration(
                  labelText: 'Élève *',
                  prefixIcon: Icon(Icons.person_outline),
                  suffixIcon: Icon(Icons.arrow_drop_down)),
              child: Text(_eleve == null
                  ? 'Choisir un élève…'
                  : '${_eleve!['prenom']} ${_eleve!['nom']}'),
            ),
          ),
          if (_solde != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                  toNum(_solde!['solde']) > 0
                      ? 'Reste à payer : ${money(_solde!['solde'])}'
                      : 'Scolarité à jour',
                  style: TextStyle(
                      color: toNum(_solde!['solde']) > 0
                          ? AppColors.bad
                          : AppColors.ok,
                      fontWeight: FontWeight.w600)),
            ),
          const SizedBox(height: 12),
          textField(_montant, 'Montant (TND) *',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
              icon: Icons.payments_outlined,
              validator: vMoney('Le montant', min: 0.01, max: 100000)),
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
              items: _modes,
              onChanged: (v) => setState(() => _mode = v ?? 'especes')),
          const SizedBox(height: 12),
          textField(_ref,
              _mode == 'especes' ? 'Référence (facultatif)' : 'Référence *',
              icon: Icons.tag,
              validator: (v) => _mode != 'especes' && (v ?? '').trim().isEmpty
                  ? 'La référence est obligatoire pour ce mode'
                  : null),
          const SizedBox(height: 18),
          BusyButton(
              busy: _busy,
              onPressed: _save,
              label: 'Enregistrer le paiement',
              icon: Icons.check),
        ]),
      ),
    );
  }
}

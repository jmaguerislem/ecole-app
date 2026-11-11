import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'sa_common.dart';
import 'school_detail_page.dart';

/// Page 3 : statistiques financières des locations.
/// Règle : seuls les loyers ENCAISSÉS sont des revenus ; les loyers prévus ou impayés sont affichés à part.
class FinanceStatsPage extends StatefulWidget {
  const FinanceStatsPage({super.key});

  @override
  State<FinanceStatsPage> createState() => _FinanceStatsPageState();
}

class _FinanceStatsPageState extends State<FinanceStatsPage> {
  int? _ecole;
  int _annee = DateTime.now().year;
  int? _mois;
  List<Map<String, dynamic>> _ecoles = [];
  List<int> _annees = [DateTime.now().year];
  int _version = 0;

  Future<Map<String, dynamic>> _load() async {
    final d = await api.getMap('/saas/finance/stats',
        query: {'ecole_id': _ecole, 'annee': _annee, 'mois': _mois});
    _ecoles = asList(d['ecoles']);
    final an = (d['annees'] is List)
        ? (d['annees'] as List).map((e) => toInt(e)).toList()
        : <int>[DateTime.now().year];
    if (an.isNotEmpty) _annees = an;
    return d;
  }

  void _apply(VoidCallback f) => setState(() {
        f();
        _version++;
      });

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      key: ValueKey(_version),
      load: _load,
      builder: (context, d, reload) {
        final t = asMap(d['totaux']);
        final par = asList(d['par_ecole']);
        final mensuel = asList(d['mensuel']);
        final retards = asList(d['retards']);
        final prochaines = asList(d['prochaines']);
        final histo = asList(d['historique']);
        final periode =
            _mois == null ? 'année $_annee' : '${moisNoms[_mois! - 1]} $_annee';
        return ScrollPage(children: [
          _filters(),
          const SizedBox(height: 12),
          Card(
            color: AppColors.brand,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        _ecole == null
                            ? 'Total des loyers encaissés · toutes les écoles'
                            : 'Total des loyers encaissés · ${_ecoles.firstWhere((e) => toInt(e['id']) == _ecole, orElse: () => {
                                  'label': 'école'
                                })['label']}',
                        style: const TextStyle(
                            color: Colors.white70, fontSize: 13)),
                    const SizedBox(height: 4),
                    Text(money(t['encaisse']),
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 30,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text('Période : $periode — argent réellement reçu',
                        style: const TextStyle(
                            color: Colors.white70, fontSize: 12)),
                  ]),
            ),
          ),
          const SizedBox(height: 12),
          StatGrid(tiles: [
            StatTile(
                icon: Icons.event_note,
                label: 'Loyers prévus',
                value: moneyShort(t['prevu']),
                color: AppColors.brand,
                hint: 'Non encaissé'),
            StatTile(
                icon: Icons.error,
                label: 'Impayés (en retard)',
                value: moneyShort(t['impaye']),
                color: AppColors.bad,
                hint: pluriel(toInt(t['nb_en_retard']), 'échéance')),
            StatTile(
                icon: Icons.schedule,
                label: 'En attente (à venir)',
                value: moneyShort(t['en_attente']),
                color: AppColors.warn,
                hint: pluriel(toInt(t['nb_en_attente']), 'échéance')),
            StatTile(
                icon: Icons.apartment,
                label: 'Loyers mensuels',
                value: moneyShort(t['loyer_mensuel_total']),
                color: AppColors.info,
                hint: 'Somme des contrats'),
          ]),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Situation des échéances',
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              StatusBar(
                  paye: toNum(t['nb_payees']).toDouble(),
                  attente: toNum(t['nb_en_attente']).toDouble(),
                  retard: toNum(t['nb_en_retard']).toDouble()),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 6, children: [
                StatusChip('${toInt(t['nb_payees'])} payée(s)', AppColors.ok,
                    icon: Icons.check_circle),
                StatusChip(
                    '${toInt(t['nb_en_attente'])} en attente', AppColors.warn,
                    icon: Icons.schedule),
                StatusChip(
                    '${toInt(t['nb_en_retard'])} en retard', AppColors.bad,
                    icon: Icons.error),
              ]),
            ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Revenus mensuels $_annee',
            child: GroupedBarChart(groups: [
              for (final m in mensuel)
                BarGroup('${m['nom']}', toNum(m['prevu']).toDouble(),
                    toNum(m['encaisse']).toDouble())
            ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Revenus par école',
            child: par.isEmpty
                ? const EmptyBox(
                    icon: Icons.payments_outlined,
                    text:
                        'Aucun contrat de location défini.\nDéfinissez le loyer d\'une école depuis « Les écoles ».')
                : HBarList(items: [
                    for (final p in par)
                      HBarItem('${p['ecole']}', toNum(p['encaisse']).toDouble(),
                          moneyShort(p['encaisse']), AppColors.ok)
                  ]),
          ),
          if (par.length > 1 || (par.length == 1 && _ecole == null)) ...[
            const SizedBox(height: 12),
            SectionCard(
              title: 'Comparatif entre les écoles',
              child: Column(children: [
                for (final p in par) _compareRow(context, p),
              ]),
            ),
          ],
          const SizedBox(height: 12),
          SectionCard(
            title: 'Retards de paiement',
            child: retards.isEmpty
                ? const Row(children: [
                    Icon(Icons.check_circle, color: AppColors.ok),
                    SizedBox(width: 8),
                    Expanded(child: Text('Aucun retard de paiement.'))
                  ])
                : Column(children: [
                    for (final r in retards)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading: const Icon(Icons.error, color: AppColors.bad),
                        title: Text('${r['ecole']}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                            'Loyer de ${moisAnnee(r['periode'])} · échu le ${dateFr(r['echeance'])}'),
                        trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(money(r['reste']),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.bad)),
                              Text('${r['jours_retard']} j de retard',
                                  style: const TextStyle(
                                      fontSize: 11, color: AppColors.bad)),
                            ]),
                        onTap: () =>
                            _open(context, toInt(r['school_id']), reload),
                      ),
                  ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Prochaines échéances',
            child: prochaines.isEmpty
                ? const Text('Aucune échéance à venir.')
                : Column(children: [
                    for (final r in prochaines)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading:
                            const Icon(Icons.schedule, color: AppColors.warn),
                        title: Text('${r['ecole']}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                            'Le ${dateFr(r['echeance'])} · dans ${r['jours_restants']} j'),
                        trailing: Text(money(r['reste']),
                            style:
                                const TextStyle(fontWeight: FontWeight.w700)),
                        onTap: () =>
                            _open(context, toInt(r['school_id']), reload),
                      ),
                  ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Historique des paiements',
            child: histo.isEmpty
                ? const Text('Aucun paiement encaissé sur cette période.')
                : Column(children: [
                    for (final p in histo.take(40))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading:
                            const Icon(Icons.check_circle, color: AppColors.ok),
                        title: Text('${p['ecole']}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                            'Loyer de ${moisAnnee(p['periode'])} · ${modeLabels['${p['mode']}'] ?? p['mode']}${str(p['reference']).isEmpty ? '' : ' · ${p['reference']}'}'),
                        trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(money(p['montant']),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.ok)),
                              Text(dateFr(p['date_paiement']),
                                  style: const TextStyle(
                                      fontSize: 11, color: Colors.black54)),
                            ]),
                      ),
                    if (histo.length > 40)
                      Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                              '+ ${histo.length - 40} autres paiements : affinez avec les filtres.',
                              style: const TextStyle(
                                  color: Colors.black54, fontSize: 12))),
                  ]),
          ),
        ]);
      },
    );
  }

  Widget _filters() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(children: [
          dropdown<int?>(
            label: 'École',
            icon: Icons.apartment,
            value: _ecole,
            items: {
              null: 'Toutes les écoles',
              for (final e in _ecoles) toInt(e['id']): '${e['label']}'
            },
            onChanged: (v) => _apply(() => _ecole = v),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: dropdown<int>(
                  label: 'Année',
                  value: _annee,
                  items: {for (final a in _annees) a: '$a'},
                  onChanged: (v) => _apply(() => _annee = v ?? _annee)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: dropdown<int?>(
                  label: 'Mois',
                  value: _mois,
                  items: {
                    null: 'Tous',
                    for (var i = 0; i < 12; i++) i + 1: moisNoms[i]
                  },
                  onChanged: (v) => _apply(() => _mois = v)),
            ),
          ]),
        ]),
      ),
    );
  }

  Widget _compareRow(BuildContext context, Map<String, dynamic> p) {
    final taux = p['taux_recouvrement'];
    final c = taux == null
        ? Colors.black45
        : (toNum(taux) >= 90
            ? AppColors.ok
            : toNum(taux) >= 60
                ? AppColors.warn
                : AppColors.bad);
    return InkWell(
      onTap: () => _open(context, toInt(p['school_id']), null),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
                child: Text('${p['ecole']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusChip(
                taux == null
                    ? 'Recouvrement —'
                    : 'Recouvrement ${nombre(toNum(taux), decimales: 0)} %',
                c),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 14, runSpacing: 2, children: [
            Text('Loyer ${moneyShort(p['loyer_mensuel'])}/mois',
                style: const TextStyle(fontSize: 12.5)),
            Text('Encaissé ${moneyShort(p['encaisse'])}',
                style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.ok,
                    fontWeight: FontWeight.w600)),
            Text('Impayé ${moneyShort(p['impaye'])}',
                style: TextStyle(
                    fontSize: 12.5,
                    color:
                        toNum(p['impaye']) > 0 ? AppColors.bad : Colors.black54,
                    fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 4),
          Text(
              '${toInt(p['echeances_payees'])} payée(s) · ${toInt(p['echeances_en_attente'])} en attente · ${toInt(p['echeances_en_retard'])} en retard',
              style: const TextStyle(fontSize: 12, color: Colors.black54)),
          const Divider(height: 16),
        ]),
      ),
    );
  }

  Future<void> _open(
      BuildContext context, int id, Future<void> Function()? reload) async {
    await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => SchoolDetailPage(schoolId: id)));
    if (reload != null) {
      await reload();
    } else {
      setState(() => _version++);
    }
  }
}

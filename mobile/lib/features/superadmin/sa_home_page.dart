import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'sa_common.dart';
import 'school_detail_page.dart';

/// Page 1 : tableau de bord général de la plateforme.
class SaHomePage extends StatelessWidget {
  final VoidCallback onOpenSchools, onOpenFinance;
  const SaHomePage(
      {super.key, required this.onOpenSchools, required this.onOpenFinance});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () => api.getMap('/saas/accueil'),
      builder: (context, d, reload) {
        final t = asMap(d['totaux']);
        final f = asMap(d['finance']);
        final ecoles = asList(d['ecoles']);
        final retards = asList(d['retards']);
        final prochaines = asList(d['prochaines']);
        final prevuMois = toNum(f['prevu_mois']);
        final encMois = toNum(f['encaisse_mois']);
        final nbRetards = toInt(f['nb_retards']);
        return ScrollPage(children: [
          StatGrid(tiles: [
            StatTile(
                icon: Icons.apartment,
                label: 'Écoles',
                value: '${toInt(t['ecoles'])}',
                hint: '${toInt(t['actives'])} active(s)'),
            StatTile(
                icon: Icons.groups,
                label: 'Élèves',
                value: '${toInt(t['eleves'])}',
                color: AppColors.info),
            StatTile(
                icon: Icons.co_present,
                label: 'Enseignants',
                value: '${toInt(t['enseignants'])}',
                color: AppColors.warn),
            StatTile(
                icon: Icons.family_restroom,
                label: 'Parents',
                value: '${toInt(t['parents'])}',
                color: AppColors.ok),
          ]),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Loyers du mois',
            trailing: TextButton(
                onPressed: onOpenFinance, child: const Text('Détails')),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                    child: _kpi('Encaissé', moneyShort(encMois), AppColors.ok)),
                Expanded(
                    child:
                        _kpi('Prévu', moneyShort(prevuMois), Colors.black87)),
              ]),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                    value: prevuMois <= 0
                        ? 0
                        : (encMois / prevuMois).clamp(0, 1).toDouble(),
                    minHeight: 10,
                    color: AppColors.ok,
                    backgroundColor: AppColors.ok.withValues(alpha: 0.15)),
              ),
              const SizedBox(height: 14),
              InfoRow('Impayés (en retard)', money(f['impaye'])),
              InfoRow('Paiements en retard',
                  nbRetards == 0 ? 'Aucun' : pluriel(nbRetards, 'échéance')),
              InfoRow('Loyers mensuels', money(f['loyer_mensuel_total'])),
              InfoRow('Encaissé cette année', money(f['encaisse_annee'])),
            ]),
          ),
          if (retards.isNotEmpty) ...[
            const SizedBox(height: 12),
            SectionCard(
              title: 'Retards de paiement',
              child: Column(children: [
                for (final r in retards)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.error, color: AppColors.bad),
                    title: Text('${r['ecole']}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                        '${moisAnnee(r['periode'])} · ${r['jours_retard']} j de retard'),
                    trailing: Text(money(r['reste']),
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, color: AppColors.bad)),
                    onTap: () =>
                        _openSchool(context, toInt(r['school_id']), reload),
                  ),
              ]),
            ),
          ],
          if (prochaines.isNotEmpty) ...[
            const SizedBox(height: 12),
            SectionCard(
              title: 'Prochaines échéances',
              child: Column(children: [
                for (final r in prochaines)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.schedule, color: AppColors.warn),
                    title: Text('${r['ecole']}',
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                        'Le ${dateFr(r['echeance'])} · dans ${r['jours_restants']} j'),
                    trailing: Text(money(r['reste']),
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    onTap: () =>
                        _openSchool(context, toInt(r['school_id']), reload),
                  ),
              ]),
            ),
          ],
          const SizedBox(height: 12),
          SectionCard(
            title: 'Écoles',
            trailing: TextButton(
                onPressed: onOpenSchools, child: const Text('Tout voir')),
            child: ecoles.isEmpty
                ? const EmptyBox(
                    icon: Icons.apartment,
                    text:
                        'Aucune école pour le moment.\nAjoutez-en une depuis « Les écoles ».')
                : Column(children: [
                    for (final e in ecoles)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${e['label']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style:
                                const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(
                            '${toInt(e['eleves'])} élèves · ${toInt(e['enseignants'])} ens. · ${toInt(e['parents'])} parents\nLoyer : ${e['loyer_mensuel'] == null ? 'non défini' : '${moneyShort(e['loyer_mensuel'])}/mois'}'),
                        isThreeLine: true,
                        trailing: schoolStatusChip(e),
                        onTap: () =>
                            _openSchool(context, toInt(e['id']), reload),
                      ),
                  ]),
          ),
        ]);
      },
    );
  }

  Widget _kpi(String label, String value, Color c) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(color: Colors.black54, fontSize: 13)),
        const SizedBox(height: 2),
        Text(value,
            style:
                TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: c)),
      ]);

  Future<void> _openSchool(
      BuildContext context, int id, Future<void> Function() reload) async {
    await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => SchoolDetailPage(schoolId: id)));
    await reload();
  }
}

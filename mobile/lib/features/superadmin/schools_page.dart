import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'sa_common.dart';
import 'school_detail_page.dart';
import 'school_form_page.dart';

/// Page 2 : liste des écoles (ajout, détail, activation/désactivation).
class SchoolsPage extends StatefulWidget {
  const SchoolsPage({super.key});

  @override
  State<SchoolsPage> createState() => _SchoolsPageState();
}

class _SchoolsPageState extends State<SchoolsPage> {
  int _version = 0;
  String _query = '';

  void _refresh() => setState(() => _version++);

  Future<void> _toggle(Map<String, dynamic> s) async {
    final active = '${s['status']}' != 'suspended';
    final ok = await confirm(
      context,
      active ? 'Désactiver l\'école ?' : 'Activer l\'école ?',
      active
          ? '« ${s['label']} » sera suspendue : ses utilisateurs ne pourront plus se connecter. Les données sont conservées et vous pourrez la réactiver à tout moment.'
          : '« ${s['label']} » sera réactivée et ses utilisateurs pourront se reconnecter.',
      action: active ? 'Désactiver' : 'Activer',
      danger: active,
    );
    if (!ok) return;
    try {
      await api.put('/saas/schools/${s['id']}',
          body: {'status': active ? 'suspended' : 'active'});
      if (mounted)
        showOk(context, active ? 'École désactivée' : 'École activée');
      _refresh();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => const SchoolFormPage()));
          if (created == true) _refresh();
        },
        icon: const Icon(Icons.add),
        label: const Text('Ajouter une école'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(
                hintText: 'Rechercher une école ou une ville',
                prefixIcon: Icon(Icons.search)),
            onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
          ),
        ),
        Expanded(
          child: AsyncView<List<Map<String, dynamic>>>(
            key: ValueKey(_version),
            load: () => api.getList('/saas/schools'),
            builder: (context, all, reload) {
              final list = all
                  .where((s) =>
                      _query.isEmpty ||
                      '${s['label']}'.toLowerCase().contains(_query) ||
                      '${s['ville'] ?? ''}'.toLowerCase().contains(_query))
                  .toList();
              if (list.isEmpty) {
                return ScrollPage(children: [
                  EmptyBox(
                      icon: Icons.apartment,
                      text: all.isEmpty
                          ? 'Aucune école. Touchez « Ajouter une école » pour commencer.'
                          : 'Aucun résultat pour cette recherche.')
                ]);
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, i) {
                  final s = list[i];
                  final active = '${s['status']}' != 'suspended';
                  return Card(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () async {
                        await Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) =>
                                SchoolDetailPage(schoolId: toInt(s['id']))));
                        _refresh();
                      },
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(children: [
                                const Icon(Icons.apartment,
                                    color: AppColors.brand),
                                const SizedBox(width: 10),
                                Expanded(
                                    child: Text('${s['label']}',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                            fontSize: 16))),
                                schoolStatusChip(s),
                              ]),
                              const SizedBox(height: 8),
                              Text(
                                  '${toInt(s['nb_eleves'])} élèves · ${toInt(s['nb_utilisateurs'])} comptes · formule ${planLabels['${s['plan']}'] ?? s['plan']}',
                                  style:
                                      const TextStyle(color: Colors.black54)),
                              if (s['subscription_end'] != null)
                                Text(
                                    'Abonnement jusqu\'au ${dateFr(s['subscription_end'])}',
                                    style: const TextStyle(
                                        color: Colors.black54, fontSize: 13)),
                              const Divider(height: 20),
                              Row(children: [
                                Expanded(
                                    child: Text(
                                        active
                                            ? 'École active'
                                            : 'École désactivée',
                                        style: TextStyle(
                                            fontWeight: FontWeight.w600,
                                            color: active
                                                ? AppColors.ok
                                                : AppColors.bad))),
                                Switch(
                                    value: active,
                                    onChanged: (_) => _toggle(s)),
                              ]),
                            ]),
                      ),
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

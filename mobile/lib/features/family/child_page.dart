import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'bulletin_page.dart';

class ChildCard extends StatelessWidget {
  final Map<String, dynamic> enfant;
  final bool showBalance;
  final VoidCallback onTap;
  const ChildCard(
      {super.key,
      required this.enfant,
      required this.showBalance,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    final solde = enfant['solde'];
    final nom = '${enfant['prenom']} ${enfant['nom']}';
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            AvatarCircle(
                '${str(enfant['prenom']).isEmpty ? '' : str(enfant['prenom'])[0]}${str(enfant['nom']).isEmpty ? '' : str(enfant['nom'])[0]}'
                    .toUpperCase(),
                size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(nom,
                        style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w800)),
                    Text(
                        str(enfant['classe_nom']).isEmpty
                            ? 'Sans classe'
                            : str(enfant['classe_nom']),
                        style: const TextStyle(color: Colors.black54)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 4, children: [
                      if (toInt(enfant['devoirs_a_rendre']) > 0)
                        StatusChip(
                            '${pluriel(toInt(enfant['devoirs_a_rendre']), 'devoir')} à rendre',
                            AppColors.warn,
                            icon: Icons.assignment_late_outlined),
                      if (showBalance && solde != null)
                        (toNum(solde) > 0
                            ? StatusChip(
                                '${money(solde)} à payer', AppColors.bad)
                            : const StatusChip('Scolarité à jour', AppColors.ok,
                                icon: Icons.check_circle)),
                    ]),
                  ]),
            ),
            const Icon(Icons.chevron_right),
          ]),
        ),
      ),
    );
  }
}

/// Détail d'un enfant : bulletin, absences, devoirs, paiements.
class ChildPage extends StatelessWidget {
  final Map<String, dynamic> enfant;
  final bool isParent;
  const ChildPage({super.key, required this.enfant, required this.isParent});

  @override
  Widget build(BuildContext context) {
    final id = toInt(enfant['id']);
    final tabs = <({String label, Widget page})>[
      (label: 'Bulletin', page: BulletinView(eleveId: id)),
      (label: 'Absences', page: _Absences(eleveId: id, canJustify: isParent)),
      (label: 'Devoirs', page: _Devoirs(eleveId: id, isParent: isParent)),
      if (isParent) (label: 'Paiements', page: _Paiements(eleveId: id)),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
            title: Text('${enfant['prenom']} ${enfant['nom']}'),
            bottom: TabBar(
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                tabs: [for (final t in tabs) Tab(text: t.label)])),
        body: TabBarView(children: [for (final t in tabs) t.page]),
      ),
    );
  }
}

class _Absences extends StatefulWidget {
  final int eleveId;
  final bool canJustify;
  const _Absences({required this.eleveId, required this.canJustify});

  @override
  State<_Absences> createState() => _AbsencesState();
}

class _AbsencesState extends State<_Absences> {
  int _version = 0;

  Future<void> _justify(Map<String, dynamic> a) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Justifier l\'absence'),
        content: TextField(
            controller: c,
            maxLines: 3,
            maxLength: 300,
            decoration: const InputDecoration(
                hintText: 'Motif (maladie, rendez-vous médical…)')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(d, false),
              child: const Text('Annuler')),
          FilledButton(
              onPressed: () => Navigator.pop(d, true),
              child: const Text('Envoyer'))
        ],
      ),
    );
    final text = c.text.trim();
    c.dispose();
    if (ok != true) return;
    if (text.length < 3) {
      if (mounted)
        showError(context,
            ApiException(0, 'Précisez le motif (3 caractères minimum).'));
      return;
    }
    try {
      await api
          .put('/absences/${a['id']}/justifier', body: {'justification': text});
      if (mounted) {
        showOk(context, 'Absence justifiée');
        setState(() => _version++);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AsyncView<List<Map<String, dynamic>>>(
      key: ValueKey(_version),
      load: () => api.getList('/absences', query: {'eleve_id': widget.eleveId}),
      builder: (context, list, reload) {
        if (list.isEmpty)
          return ScrollPage(children: const [
            EmptyBox(
                icon: Icons.event_available,
                text: 'Aucune absence enregistrée.')
          ]);
        const periodes = {
          'matin': 'Matin',
          'apres_midi': 'Après-midi',
          'journee': 'Journée'
        };
        return ScrollPage(children: [
          for (final a in list)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: ListTile(
                  leading: Icon(
                      a['justifiee'] == true
                          ? Icons.check_circle
                          : Icons.error_outline,
                      color: a['justifiee'] == true
                          ? AppColors.ok
                          : AppColors.warn),
                  title: Text(
                      '${dateFr(a['date_absence'])} · ${periodes['${a['periode']}'] ?? a['periode'] ?? 'Journée'}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(a['justifiee'] == true
                      ? 'Justifiée : ${str(a['justification'])}'
                      : 'Non justifiée${str(a['motif']).isEmpty ? '' : ' · ${a['motif']}'}'),
                  trailing: (widget.canJustify && a['justifiee'] != true)
                      ? TextButton(
                          onPressed: () => _justify(a),
                          child: const Text('Justifier'))
                      : null,
                ),
              ),
            ),
        ]);
      },
    );
  }
}

class _Devoirs extends StatelessWidget {
  final int eleveId;
  final bool isParent;
  const _Devoirs({required this.eleveId, required this.isParent});

  static const _statuts = {
    'a_faire': ('À faire', AppColors.warn),
    'rendu': ('Rendu', AppColors.info),
    'en_retard': ('Rendu en retard', AppColors.warn),
    'non_rendu': ('Non rendu', AppColors.bad),
    'note': ('Noté', AppColors.ok),
  };

  @override
  Widget build(BuildContext context) {
    return AsyncView<List<Map<String, dynamic>>>(
      load: () => api.getList('/devoirs', query: {'eleve_id': eleveId}),
      builder: (context, list, reload) {
        if (list.isEmpty)
          return ScrollPage(children: const [
            EmptyBox(icon: Icons.assignment_outlined, text: 'Aucun devoir.')
          ]);
        return ScrollPage(children: [
          for (final d in list)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Expanded(
                              child: Text(str(d['titre']),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 15))),
                          () {
                            final s = _statuts['${d['statut']}'] ??
                                ('—', Colors.black45);
                            return StatusChip(s.$1, s.$2);
                          }(),
                        ]),
                        const SizedBox(height: 4),
                        Text(
                            '${str(d['matiere_nom'])} · à rendre le ${dateTimeFr(d['date_remise'])}',
                            style: const TextStyle(
                                color: Colors.black54, fontSize: 13)),
                        if (str(d['description']).isNotEmpty)
                          Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(str(d['description']))),
                        if (d['note'] != null)
                          Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                  'Note : ${toNum(d['note'])} / ${toNum(d['bareme'])}${str(d['commentaire']).isEmpty ? '' : ' — ${d['commentaire']}'}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.ok))),
                        if (isParent && d['vu'] != true)
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton.icon(
                              onPressed: () async {
                                try {
                                  await api.post('/devoirs/${d['id']}/vu',
                                      query: {'eleve_id': eleveId},
                                      body: {'eleve_id': eleveId});
                                  await reload();
                                } catch (e) {
                                  if (context.mounted) showError(context, e);
                                }
                              },
                              icon: const Icon(Icons.visibility_outlined,
                                  size: 18),
                              label: const Text('Marquer comme vu'),
                            ),
                          ),
                      ]),
                ),
              ),
            ),
        ]);
      },
    );
  }
}

class _Paiements extends StatelessWidget {
  final int eleveId;
  const _Paiements({required this.eleveId});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () async {
        final s = await api.getMap('/paiements/solde/$eleveId');
        final p = await api.getList('/paiements', query: {'eleve_id': eleveId});
        return {'solde': s, 'paiements': p};
      },
      builder: (context, d, reload) {
        final s = asMap(d['solde']);
        final p = asList(d['paiements']);
        const modes = {
          'especes': 'Espèces',
          'virement': 'Virement',
          'mobile_money': 'Mobile money'
        };
        return ScrollPage(children: [
          SectionCard(
            title: 'Scolarité ${str(s['annee_scolaire'])}',
            child: Column(children: [
              InfoRow('Total dû', money(s['total_du'])),
              InfoRow('Total payé', money(s['total_paye'])),
              Row(children: [
                const SizedBox(
                    width: 120,
                    child: Text('Reste à payer',
                        style: TextStyle(color: Colors.black54))),
                toNum(s['solde']) > 0
                    ? StatusChip(money(s['solde']), AppColors.bad)
                    : const StatusChip('À jour', AppColors.ok,
                        icon: Icons.check_circle),
              ]),
            ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Paiements effectués',
            child: p.isEmpty
                ? const Text('Aucun paiement enregistré.')
                : Column(children: [
                    for (final x in p)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading:
                            const Icon(Icons.receipt_long, color: AppColors.ok),
                        title: Text(
                            '${money(x['montant'])} · ${modes['${x['mode']}'] ?? x['mode']}'),
                        subtitle: Text(
                            '${str(x['numero_recu'])}${str(x['tarif_libelle']).isEmpty ? '' : ' · ${x['tarif_libelle']}'}'),
                        trailing: Text(dateFr(x['date_paiement']),
                            style: const TextStyle(
                                fontSize: 12, color: Colors.black54)),
                      ),
                  ]),
          ),
        ]);
      },
    );
  }
}

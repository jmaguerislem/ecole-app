import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// Bulletin pleine page (utilisé par l'administration).
class BulletinPage extends StatelessWidget {
  final int eleveId;
  final String nom;
  const BulletinPage({super.key, required this.eleveId, required this.nom});

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text('Bulletin · $nom')),
      body: BulletinView(eleveId: eleveId));
}

/// Bulletin d'un élève par trimestre : moyennes par matière, moyenne générale, rang, absences.
class BulletinView extends StatefulWidget {
  final int eleveId;
  const BulletinView({super.key, required this.eleveId});

  @override
  State<BulletinView> createState() => _BulletinViewState();
}

class _BulletinViewState extends State<BulletinView> {
  int _tri = 1;

  Color _color(num m) => m >= 14
      ? AppColors.ok
      : m >= 10
          ? AppColors.warn
          : AppColors.bad;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 1, label: Text('Trim. 1')),
            ButtonSegment(value: 2, label: Text('Trim. 2')),
            ButtonSegment(value: 3, label: Text('Trim. 3'))
          ],
          selected: {_tri},
          onSelectionChanged: (s) => setState(() => _tri = s.first),
        ),
      ),
      Expanded(
        child: AsyncView<Map<String, dynamic>>(
          key: ValueKey(_tri),
          load: () => api.getMap('/eleves/${widget.eleveId}/bulletin',
              query: {'trimestre': _tri}),
          builder: (context, b, reload) {
            final matieres = asList(b['matieres']);
            final abs = asMap(b['absences']);
            final mg = b['moyenne_generale'];
            return ScrollPage(children: [
              Card(
                color: AppColors.brand,
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Row(children: [
                    Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Moyenne générale',
                                style: TextStyle(color: Colors.white70)),
                            Text(mg == null ? '—' : '${nombre(toNum(mg))} / 20',
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 30,
                                    fontWeight: FontWeight.w800)),
                            Text(str(b['appreciation']),
                                style: const TextStyle(color: Colors.white70)),
                          ]),
                    ),
                    if (b['rang'] != null)
                      Column(children: [
                        Text(
                            '${b['rang']}${toInt(b['rang']) == 1 ? 'er' : 'ème'}',
                            style: const TextStyle(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.w800)),
                        Text('sur ${toInt(b['effectif'])}',
                            style: const TextStyle(
                                color: Colors.white70, fontSize: 12)),
                      ]),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: 'Moyennes par matière',
                child: matieres.isEmpty
                    ? const Text('Aucune note saisie pour ce trimestre.')
                    : Column(children: [
                        for (final m in matieres)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            child: Row(children: [
                              Expanded(
                                  child: Text(str(m['nom']),
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600))),
                              Text('coef. ${toNum(m['coefficient'])}',
                                  style: const TextStyle(
                                      color: Colors.black45, fontSize: 12)),
                              const SizedBox(width: 12),
                              StatusChip(nombre(toNum(m['moyenne'])),
                                  _color(toNum(m['moyenne']))),
                            ]),
                          ),
                      ]),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: 'Assiduité',
                child: Column(children: [
                  InfoRow('Absences justifiées', '${toInt(abs['justifiees'])}'),
                  InfoRow('Non justifiées', '${toInt(abs['non_justifiees'])}'),
                  if (b['moyenne_classe'] != null)
                    InfoRow('Moyenne de la classe',
                        '${nombre(toNum(b['moyenne_classe']))} / 20'),
                ]),
              ),
            ]);
          },
        ),
      ),
    ]);
  }
}

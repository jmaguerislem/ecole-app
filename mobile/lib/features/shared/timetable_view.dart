import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// Emploi du temps en lecture seule, regroupé par jour (élève, parent, enseignant).
class TimetableView extends StatelessWidget {
  final int? classeId;
  final bool showTeacher;
  const TimetableView({super.key, this.classeId, this.showTeacher = true});

  @override
  Widget build(BuildContext context) {
    return AsyncView<List<Map<String, dynamic>>>(
      key: ValueKey('edt$classeId'),
      load: () => api.getList('/creneaux', query: {'classe_id': classeId}),
      builder: (context, list, reload) {
        if (list.isEmpty) {
          return ScrollPage(children: const [
            EmptyBox(
                icon: Icons.calendar_month_outlined,
                text: 'Aucun cours programmé pour le moment.')
          ]);
        }
        final today = DateTime.now().weekday;
        return ScrollPage(children: [
          for (var j = 1; j <= 6; j++)
            if (list.any((c) => toInt(c['jour']) == j)) ...[
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 8),
                child: Row(children: [
                  Text(joursSemaine[j - 1],
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w800)),
                  if (j == today) ...[
                    const SizedBox(width: 8),
                    const StatusChip('Aujourd\'hui', AppColors.info)
                  ],
                ]),
              ),
              for (final c in list.where((c) => toInt(c['jour']) == j))
                Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: CreneauTile(c: c, showTeacher: showTeacher)),
            ],
        ]);
      },
    );
  }
}

class CreneauTile extends StatelessWidget {
  final Map<String, dynamic> c;
  final bool showTeacher;
  final VoidCallback? onTap;
  final Widget? trailing;
  const CreneauTile(
      {super.key,
      required this.c,
      this.showTeacher = true,
      this.onTap,
      this.trailing});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Container(
              width: 62,
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                  color: AppColors.brand.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12)),
              child: Column(children: [
                Text(hm(c['heure_debut']),
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                const Text('à',
                    style: TextStyle(fontSize: 11, color: Colors.black45)),
                Text(hm(c['heure_fin']),
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              ]),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${c['matiere_nom']}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 15)),
                    Text(
                        '${c['classe_nom']}${showTeacher ? ' · ${c['enseignant_nom']}' : ''}',
                        style: const TextStyle(color: Colors.black54)),
                    if (str(c['salle_nom']).isNotEmpty)
                      Row(children: [
                        const Icon(Icons.meeting_room_outlined,
                            size: 14, color: Colors.black45),
                        const SizedBox(width: 4),
                        Text('${c['salle_nom']}',
                            style: const TextStyle(
                                fontSize: 13, color: Colors.black54))
                      ]),
                  ]),
            ),
            if (trailing != null) trailing!,
          ]),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';

/// Affiche les conflits d'emploi du temps et propose des alternatives cliquables
/// (autres salles libres, autres créneaux libres pour l'enseignant, la classe et la salle).
class ConflictPanel extends StatelessWidget {
  final List<Map<String, dynamic>> conflits;
  final List<Map<String, dynamic>> salles;
  final List<Map<String, dynamic>> creneaux;
  final void Function(int salleId) onPickRoom;
  final void Function(int jour, String debut, String fin) onPickSlot;
  const ConflictPanel(
      {super.key,
      required this.conflits,
      required this.salles,
      required this.creneaux,
      required this.onPickRoom,
      required this.onPickSlot});

  static const _titres = {
    'salle': 'Salle déjà réservée',
    'enseignant': 'Enseignant déjà occupé',
    'classe': 'Classe déjà en cours'
  };
  static const _icones = {
    'salle': Icons.meeting_room,
    'enseignant': Icons.person_off,
    'classe': Icons.groups
  };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: AppColors.bad.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.bad.withValues(alpha: 0.4))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.event_busy, color: AppColors.bad),
          SizedBox(width: 8),
          Expanded(
              child: Text('Conflit d\'emploi du temps — créneau refusé',
                  style: TextStyle(
                      fontWeight: FontWeight.w800, color: AppColors.bad)))
        ]),
        const SizedBox(height: 10),
        for (final c in conflits)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(_icones['${c['type']}'] ?? Icons.error_outline,
                  size: 18, color: AppColors.bad),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          '${_titres['${c['type']}'] ?? 'Conflit'} · ${c['jour_nom']} ${c['debut']}–${c['fin']}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('${c['message']}',
                          style: const TextStyle(fontSize: 13, height: 1.3)),
                    ]),
              ),
            ]),
          ),
        if (salles.isNotEmpty) ...[
          const SizedBox(height: 4),
          const Text('Salles libres sur ce créneau :',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, children: [
            for (final s in salles)
              ActionChip(
                  avatar: const Icon(Icons.meeting_room_outlined, size: 16),
                  label: Text('${s['nom']}'),
                  onPressed: () => onPickRoom(toInt(s['id'])))
          ]),
        ],
        if (creneaux.isNotEmpty) ...[
          const SizedBox(height: 10),
          const Text('Autres créneaux disponibles :',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, children: [
            for (final s in creneaux)
              ActionChip(
                  avatar: const Icon(Icons.schedule, size: 16),
                  label: Text(
                      '${joursSemaine[(toInt(s['jour']) - 1).clamp(0, 5)]} ${s['debut']}–${s['fin']}'),
                  onPressed: () => onPickSlot(
                      toInt(s['jour']), '${s['debut']}', '${s['fin']}')),
          ]),
        ],
      ]),
    );
  }
}

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'student_form_page.dart';

class AdminHomePage extends StatelessWidget {
  final bool isAdmin;
  final void Function(String label) onGo;
  const AdminHomePage({super.key, required this.isAdmin, required this.onGo});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () => api.getMap('/dashboard'),
      builder: (context, d, reload) {
        return ScrollPage(children: [
          Text('Année scolaire ${d['annee']}',
              style: const TextStyle(color: Colors.black54)),
          const SizedBox(height: 10),
          StatGrid(tiles: [
            StatTile(
                icon: Icons.groups,
                label: 'Élèves actifs',
                value: '${toInt(d['eleves'])}',
                color: AppColors.info),
            StatTile(
                icon: Icons.class_,
                label: 'Classes',
                value: '${toInt(d['classes'])}'),
            StatTile(
                icon: Icons.co_present,
                label: 'Enseignants',
                value: '${toInt(d['enseignants'])}',
                color: AppColors.warn),
            StatTile(
                icon: Icons.payments,
                label: 'Encaissé ce mois',
                value: moneyShort(d['paiements_mois']),
                color: AppColors.ok),
            StatTile(
                icon: Icons.error_outline,
                label: 'Élèves avec impayé',
                value: '${toInt(d['impayes'])}',
                color: AppColors.bad,
                hint: money(d['total_impaye'])),
            StatTile(
                icon: Icons.how_to_reg,
                label: 'Pré-inscriptions',
                value: '${toInt(d['preinscriptions_attente'])}',
                hint: 'en attente'),
          ]),
          const SizedBox(height: 16),
          const Text('Actions rapides',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: () async {
              final ok = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(builder: (_) => const StudentFormPage()));
              if (ok == true) await reload();
            },
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Ajouter un élève'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
              onPressed: () => onGo('Paiements'),
              icon: const Icon(Icons.add_card),
              label: const Text('Enregistrer un paiement')),
          if (isAdmin) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
                onPressed: () => onGo('Emploi du temps'),
                icon: const Icon(Icons.calendar_month),
                label: const Text('Gérer l\'emploi du temps')),
          ],
        ]);
      },
    );
  }
}

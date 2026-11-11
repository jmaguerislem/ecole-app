import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../shared/account_page.dart';
import '../shared/timetable_view.dart';
import 'attendance_page.dart';
import 'grades_page.dart';

class TeacherShell extends StatefulWidget {
  final AppUser user;
  const TeacherShell({super.key, required this.user});

  @override
  State<TeacherShell> createState() => _TeacherShellState();
}

class _TeacherShellState extends State<TeacherShell> {
  int _index = 0;
  static const _labels = [
    'Accueil',
    'Emploi du temps',
    'Appel',
    'Notes',
    'Compte'
  ];
  static const _icons = [
    Icons.dashboard_outlined,
    Icons.calendar_month_outlined,
    Icons.how_to_reg_outlined,
    Icons.grade_outlined,
    Icons.person_outline
  ];

  Widget _page() {
    switch (_index) {
      case 1:
        return const TimetableView(showTeacher: false);
      case 2:
        return const AttendancePage();
      case 3:
        return const GradesPage();
      case 4:
        return AccountPage(user: widget.user);
      default:
        return const _TeacherHome();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          title: Text(
              _index == 0 ? 'Bonjour ${widget.user.prenom}' : _labels[_index])),
      body: KeyedSubtree(key: ValueKey(_index), child: _page()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (v) => setState(() => _index = v),
        destinations: [
          for (var i = 0; i < _labels.length; i++)
            NavigationDestination(icon: Icon(_icons[i]), label: _labels[i])
        ],
      ),
    );
  }
}

class _TeacherHome extends StatelessWidget {
  const _TeacherHome();

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () async {
        final d = await api.getMap('/dashboard');
        final c = await api.getList('/creneaux');
        return {'dash': d, 'creneaux': c};
      },
      builder: (context, d, reload) {
        final dash = asMap(d['dash']);
        final today = DateTime.now().weekday;
        final cours = asList(d['creneaux'])
            .where((c) => toInt(c['jour']) == today)
            .toList();
        return ScrollPage(children: [
          StatGrid(tiles: [
            StatTile(
                icon: Icons.class_,
                label: 'Mes classes',
                value: '${toInt(dash['classes'])}',
                color: AppColors.info),
            StatTile(
                icon: Icons.schedule,
                label: 'Cours aujourd\'hui',
                value: '${toInt(dash['cours_aujourdhui'])}',
                color: AppColors.warn),
            StatTile(
                icon: Icons.assignment,
                label: 'Devoirs en cours',
                value: '${toInt(dash['devoirs_en_cours'])}',
                color: AppColors.ok),
          ]),
          const SizedBox(height: 14),
          Text(
              today <= 6
                  ? 'Mes cours du ${joursSemaine[today - 1].toLowerCase()}'
                  : 'Dimanche : pas de cours',
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (cours.isEmpty)
            const EmptyBox(
                icon: Icons.event_available, text: 'Aucun cours aujourd\'hui.'),
          for (final c in cours)
            Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: CreneauTile(c: c, showTeacher: false)),
        ]);
      },
    );
  }
}

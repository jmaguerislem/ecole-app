import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/json.dart';
import '../../core/ui.dart';
import '../shared/account_page.dart';
import '../shared/timetable_view.dart';
import 'child_page.dart';

/// Espace parent (un compte → tous ses enfants) et élève.
class FamilyShell extends StatefulWidget {
  final AppUser user;
  const FamilyShell({super.key, required this.user});

  @override
  State<FamilyShell> createState() => _FamilyShellState();
}

class _FamilyShellState extends State<FamilyShell> {
  int _index = 0;
  int _version = 0;

  bool get _isParent => widget.user.role == 'parent';

  @override
  Widget build(BuildContext context) {
    final labels = [
      _isParent ? 'Mes enfants' : 'Mon espace',
      'Emploi du temps',
      'Compte'
    ];
    final icons = [
      Icons.family_restroom,
      Icons.calendar_month_outlined,
      Icons.person_outline
    ];
    return Scaffold(
      appBar: AppBar(
          title: Text(
              _index == 0 ? 'Bonjour ${widget.user.prenom}' : labels[_index])),
      body: IndexedStack(index: _index, children: [
        _Children(key: ValueKey('c$_version'), isParent: _isParent),
        _index == 1 ? const _FamilyTimetable() : const SizedBox(),
        AccountPage(user: widget.user),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (v) => setState(() {
          _index = v;
          if (v == 0) _version++;
        }),
        destinations: [
          for (var i = 0; i < labels.length; i++)
            NavigationDestination(icon: Icon(icons[i]), label: labels[i])
        ],
      ),
    );
  }
}

class _Children extends StatelessWidget {
  final bool isParent;
  const _Children({super.key, required this.isParent});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () => api.getMap('/dashboard'),
      builder: (context, d, reload) {
        final enfants = asList(d['enfants']);
        if (enfants.isEmpty) {
          return ScrollPage(children: [
            EmptyBox(
                icon: Icons.child_care,
                text: isParent
                    ? 'Aucun enfant n\'est rattaché à votre compte pour le moment.\nContactez l\'administration de l\'école.'
                    : 'Aucune fiche élève liée à votre compte.')
          ]);
        }
        return ScrollPage(children: [
          for (final e in enfants)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: ChildCard(
                  enfant: e,
                  showBalance: isParent,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) =>
                          ChildPage(enfant: e, isParent: isParent)))),
            ),
        ]);
      },
    );
  }
}

class _FamilyTimetable extends StatefulWidget {
  const _FamilyTimetable();

  @override
  State<_FamilyTimetable> createState() => _FamilyTimetableState();
}

class _FamilyTimetableState extends State<_FamilyTimetable> {
  int? _classe;

  @override
  Widget build(BuildContext context) {
    // Plusieurs enfants dans des classes différentes : on choisit la classe affichée.
    return AsyncView<List<Map<String, dynamic>>>(
      load: () => api.getList('/classes'),
      builder: (context, classes, reload) {
        if (classes.isEmpty)
          return ScrollPage(children: const [
            EmptyBox(
                icon: Icons.calendar_month_outlined, text: 'Aucune classe.')
          ]);
        _classe ??= toInt(classes.first['id']);
        return Column(children: [
          if (classes.length > 1)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: DropdownButtonFormField<int>(
                key: ValueKey('classe$_classe'),
                initialValue: _classe,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Classe'),
                items: [
                  for (final c in classes)
                    DropdownMenuItem(
                        value: toInt(c['id']), child: Text('${c['nom']}'))
                ],
                onChanged: (v) => setState(() => _classe = v),
              ),
            ),
          Expanded(child: TimetableView(classeId: _classe, showTeacher: true)),
        ]);
      },
    );
  }

  static int toInt(dynamic v) => int.tryParse('$v') ?? 0;
}

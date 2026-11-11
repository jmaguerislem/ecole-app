import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../shared/timetable_view.dart';
import 'creneau_form_page.dart';

/// Gestion de l'emploi du temps par classe et par jour (administration).
class TimetableManagePage extends StatefulWidget {
  const TimetableManagePage({super.key});

  @override
  State<TimetableManagePage> createState() => _TimetableManagePageState();
}

class _Data {
  final List<Map<String, dynamic>> classes,
      matieres,
      enseignants,
      salles,
      creneaux;
  _Data(this.classes, this.matieres, this.enseignants, this.salles,
      this.creneaux);
}

class _TimetableManagePageState extends State<TimetableManagePage> {
  int? _classe;
  int _jour = DateTime.now().weekday.clamp(1, 6);
  int _version = 0;

  Future<_Data> _load() async {
    final r = await Future.wait([
      api.getList('/classes'),
      api.getList('/matieres'),
      api.getList('/users', query: {'role': 'enseignant'}),
      api.getList('/salles'),
      api.getList('/creneaux'),
    ]);
    return _Data(r[0], r[1], r[2], r[3], r[4]);
  }

  Future<void> _open(_Data d, {Map<String, dynamic>? c}) async {
    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => CreneauFormPage(
          creneau: c,
          classeId: _classe,
          jour: _jour,
          classes: d.classes,
          matieres: d.matieres,
          enseignants: d.enseignants,
          salles: d.salles),
    ));
    if (ok == true) setState(() => _version++);
  }

  Future<void> _delete(Map<String, dynamic> c) async {
    if (!await confirm(context, 'Supprimer la séance ?',
        '${c['matiere_nom']} · ${joursSemaine[toInt(c['jour']) - 1]} ${hm(c['heure_debut'])}–${hm(c['heure_fin'])}',
        action: 'Supprimer', danger: true)) return;
    try {
      await api.delete('/creneaux/${c['id']}');
      if (mounted) {
        showOk(context, 'Séance supprimée');
        setState(() => _version++);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AsyncView<_Data>(
      key: ValueKey(_version),
      load: _load,
      builder: (context, d, reload) {
        if (d.classes.isEmpty)
          return ScrollPage(children: const [
            EmptyBox(
                icon: Icons.class_outlined,
                text:
                    'Créez d\'abord une classe pour construire son emploi du temps.')
          ]);
        _classe ??= toInt(d.classes.first['id']);
        if (!d.classes.any((c) => toInt(c['id']) == _classe))
          _classe = toInt(d.classes.first['id']);
        final list = d.creneaux
            .where((c) =>
                toInt(c['classe_id']) == _classe && toInt(c['jour']) == _jour)
            .toList();
        return Scaffold(
          backgroundColor: Colors.transparent,
          floatingActionButton: FloatingActionButton.extended(
              onPressed: () => _open(d),
              icon: const Icon(Icons.add),
              label: const Text('Ajouter une séance')),
          body: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: DropdownButtonFormField<int>(
                key: ValueKey('classe$_classe'),
                initialValue: _classe,
                isExpanded: true,
                decoration: const InputDecoration(
                    labelText: 'Classe',
                    prefixIcon: Icon(Icons.class_outlined)),
                items: [
                  for (final c in d.classes)
                    DropdownMenuItem(
                        value: toInt(c['id']), child: Text('${c['nom']}'))
                ],
                onChanged: (v) => setState(() => _classe = v),
              ),
            ),
            SizedBox(
              height: 46,
              child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (var j = 1; j <= 6; j++)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ChoiceChip(
                          label: Text(
                              '${joursSemaine[j - 1]} (${d.creneaux.where((c) => toInt(c['classe_id']) == _classe && toInt(c['jour']) == j).length})'),
                          selected: _jour == j,
                          onSelected: (_) => setState(() => _jour = j),
                        ),
                      ),
                  ]),
            ),
            Expanded(
              child: list.isEmpty
                  ? ScrollPage(children: [
                      EmptyBox(
                          icon: Icons.event_available,
                          text:
                              'Aucune séance le ${joursSemaine[_jour - 1].toLowerCase()}.')
                    ])
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final c = list[i];
                        return CreneauTile(
                          c: c,
                          onTap: () => _open(d, c: c),
                          trailing: IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  color: AppColors.bad),
                              onPressed: () => _delete(c)),
                        );
                      },
                    ),
            ),
          ]),
        );
      },
    );
  }
}

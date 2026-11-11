import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

const _periodes = {
  'journee': 'Journée',
  'matin': 'Matin',
  'apres_midi': 'Après-midi'
};

/// « Faire l'appel » : l'enseignant marque les absents d'une de ses classes pour une date.
class AttendancePage extends StatefulWidget {
  const AttendancePage({super.key});

  @override
  State<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends State<AttendancePage> {
  List<Map<String, dynamic>> _classes = [];
  int? _classe;
  String _date = isoDate(DateTime.now());
  bool _loadingClasses = true;
  String? _error;
  int _version = 0;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final c = await api.getList('/absences/appel/classes');
      if (mounted) {
        setState(() {
          _classes = c;
          _classe = c.isEmpty ? null : toInt(c.first['id']);
          _loadingClasses = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = errorText(e);
          _loadingClasses = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingClasses)
      return const Center(child: CircularProgressIndicator());
    if (_error != null)
      return ErrorBox(
          message: _error!,
          onRetry: () {
            setState(() {
              _loadingClasses = true;
              _error = null;
            });
            _init();
          });
    if (_classes.isEmpty)
      return ScrollPage(children: const [
        EmptyBox(
            icon: Icons.class_outlined,
            text: 'Aucune classe ne vous est affectée pour le moment.')
      ]);
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Row(children: [
          Expanded(
            flex: 3,
            child: DropdownButtonFormField<int>(
              key: ValueKey('classe$_classe'),
              initialValue: _classe,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Classe'),
              items: [
                for (final c in _classes)
                  DropdownMenuItem(
                      value: toInt(c['id']), child: Text('${c['nom']}'))
              ],
              onChanged: (v) => setState(() {
                _classe = v;
                _version++;
              }),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 2,
            child: PickerField(
              label: 'Date',
              value: dateFr(_date),
              onTap: () async {
                final d = await pickDate(context,
                    initial: _date, last: DateTime.now());
                if (d != null) {
                  setState(() {
                    _date = d;
                    _version++;
                  });
                }
              },
            ),
          ),
        ]),
      ),
      Expanded(
          child: _Roll(
              key: ValueKey('$_classe$_date$_version'),
              classeId: _classe!,
              date: _date)),
    ]);
  }
}

class _Roll extends StatefulWidget {
  final int classeId;
  final String date;
  const _Roll({super.key, required this.classeId, required this.date});

  @override
  State<_Roll> createState() => _RollState();
}

class _RollState extends State<_Roll> {
  late Future<List<Map<String, dynamic>>> _future;
  final Map<int, String?> _absent = {}; // eleve_id -> periode (null = présent)
  final Set<int> _locked = {};
  bool _busy = false;
  bool _init = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final d = await api.getMap('/absences/appel',
        query: {'classe_id': widget.classeId, 'date': widget.date});
    final list = asList(d['eleves']);
    if (!_init) {
      for (final e in list) {
        final id = toInt(e['eleve_id']);
        if (e['absence_id'] != null) {
          _absent[id] = '${e['periode'] ?? 'journee'}';
          if (e['justifiee'] == true) _locked.add(id);
        }
      }
      _init = true;
    }
    return list;
  }

  Future<void> _save(List<Map<String, dynamic>> eleves) async {
    setState(() => _busy = true);
    try {
      final absents = [
        for (final e in eleves)
          if (_absent[toInt(e['eleve_id'])] != null)
            {
              'eleve_id': toInt(e['eleve_id']),
              'periode': _absent[toInt(e['eleve_id'])]
            },
      ];
      await api.put('/absences/appel', body: {
        'classe_id': widget.classeId,
        'date_absence': widget.date,
        'absents': absents
      });
      if (mounted)
        showOk(
            context, 'Appel enregistré : ${pluriel(absents.length, 'absent')}');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done)
          return const Center(child: CircularProgressIndicator());
        if (snap.hasError)
          return ErrorBox(
              message: errorText(snap.error!),
              onRetry: () => setState(() => _future = _load()));
        final eleves = snap.data!;
        if (eleves.isEmpty)
          return ScrollPage(children: const [
            EmptyBox(
                icon: Icons.groups_outlined,
                text: 'Aucun élève actif dans cette classe.')
          ]);
        final nbAbs = _absent.values.where((v) => v != null).length;
        return Column(children: [
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              itemCount: eleves.length,
              separatorBuilder: (_, __) => const SizedBox(height: 6),
              itemBuilder: (context, i) {
                final e = eleves[i];
                final id = toInt(e['eleve_id']);
                final abs = _absent[id] != null;
                final locked = _locked.contains(id);
                return Card(
                  color: abs ? AppColors.bad.withValues(alpha: 0.06) : null,
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: Row(children: [
                      Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${e['nom']} ${e['prenom']}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700)),
                              if (locked)
                                const Text(
                                    'Absence justifiée (modifiable par la direction)',
                                    style: TextStyle(
                                        fontSize: 11.5, color: AppColors.ok)),
                            ]),
                      ),
                      if (abs && !locked)
                        DropdownButton<String>(
                          value: _absent[id],
                          underline: const SizedBox(),
                          items: [
                            for (final p in _periodes.entries)
                              DropdownMenuItem(
                                  value: p.key,
                                  child: Text(p.value,
                                      style: const TextStyle(fontSize: 13)))
                          ],
                          onChanged: (v) => setState(() => _absent[id] = v),
                        ),
                      const SizedBox(width: 6),
                      Switch(
                        value: abs,
                        activeThumbColor: Colors.white,
                        activeTrackColor: AppColors.bad,
                        onChanged: locked
                            ? null
                            : (v) => setState(
                                () => _absent[id] = v ? 'journee' : null),
                      ),
                    ]),
                  ),
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text('$nbAbs absent(s) sur ${eleves.length} élèves',
                    style: const TextStyle(color: Colors.black54)),
                const SizedBox(height: 6),
                SizedBox(
                    width: double.infinity,
                    child: BusyButton(
                        busy: _busy,
                        onPressed: () => _save(eleves),
                        label: 'Enregistrer l\'appel',
                        icon: Icons.check)),
              ]),
            ),
          ),
        ]);
      },
    );
  }
}

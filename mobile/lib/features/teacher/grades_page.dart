import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';

/// Évaluations de l'enseignant + saisie des notes.
class GradesPage extends StatefulWidget {
  const GradesPage({super.key});

  @override
  State<GradesPage> createState() => _GradesPageState();
}

class _GradesPageState extends State<GradesPage> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => const EvaluationFormPage()));
          if (ok == true) setState(() => _version++);
        },
        icon: const Icon(Icons.add),
        label: const Text('Nouvelle évaluation'),
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_version),
        load: () => api.getList('/evaluations'),
        builder: (context, list, reload) {
          if (list.isEmpty) {
            return ScrollPage(children: const [
              EmptyBox(
                  icon: Icons.grade_outlined,
                  text:
                      'Aucune évaluation. Créez-en une pour saisir les notes.')
            ]);
          }
          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final e = list[i];
              return Card(
                child: ListTile(
                  title: Text('${e['titre']}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                      '${e['matiere_nom']} · ${e['classe_nom']}\nTrimestre ${e['trimestre'] ?? '—'} · sur ${e['bareme']} · ${dateFr(e['date_eval'])}'),
                  isThreeLine: true,
                  trailing: StatusChip(
                      '${toInt(e['nb_notes'])} note(s)', AppColors.info),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) =>
                            GradeEntryPage(evaluationId: toInt(e['id']))));
                    setState(() => _version++);
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class GradeEntryPage extends StatefulWidget {
  final int evaluationId;
  const GradeEntryPage({super.key, required this.evaluationId});

  @override
  State<GradeEntryPage> createState() => _GradeEntryPageState();
}

class _GradeEntryPageState extends State<GradeEntryPage> {
  final Map<int, TextEditingController> _ctrl = {};
  bool _busy = false;
  late final Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() async {
    final d = await api.getMap('/evaluations/${widget.evaluationId}/notes');
    for (final e in asList(d['eleves'])) {
      _ctrl[toInt(e['eleve_id'])] = TextEditingController(
          text: e['valeur'] == null
              ? ''
              : '${toNum(e['valeur'])}'.replaceAll('.', ','));
    }
    return d;
  }

  @override
  void dispose() {
    for (final c in _ctrl.values) {
      c.dispose();
    }
    super.dispose();
  }

  String? _check(String text, num bareme) {
    final t = text.trim();
    if (t.isEmpty) return null;
    final v = parseDecimal(t);
    if (v == null) return 'Nombre invalide';
    if (v < 0 || v > bareme) return 'Entre 0 et $bareme';
    if ((v * 4 - (v * 4).roundToDouble()).abs() > 1e-9) {
      return 'Par pas de 0,25';
    }
    return null;
  }

  Future<void> _save(Map<String, dynamic> d) async {
    final bareme = toNum(asMap(d['evaluation'])['bareme']);
    for (final c in _ctrl.values) {
      if (_check(c.text, bareme) != null) {
        showError(
            context,
            ApiException(
                0, 'Corrigez les notes en rouge avant d\'enregistrer.'));
        setState(() {});
        return;
      }
    }
    setState(() => _busy = true);
    try {
      await api.put('/evaluations/${widget.evaluationId}/notes', body: {
        'notes': [
          for (final e in _ctrl.entries)
            {
              'eleve_id': e.key,
              'valeur':
                  e.value.text.trim().isEmpty ? '' : parseDecimal(e.value.text)
            }
        ],
      });
      if (mounted) {
        showOk(context, 'Notes enregistrées');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saisie des notes')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) return ErrorBox(message: errorText(snap.error!));
          final d = snap.data!;
          final ev = asMap(d['evaluation']);
          final eleves = asList(d['eleves']);
          final bareme = toNum(ev['bareme']);
          return Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                      '${ev['titre']} · ${ev['matiere_nom']} · ${ev['classe_nom']}\nNote sur $bareme (laisser vide = pas de note)',
                      style:
                          const TextStyle(color: Colors.black54, height: 1.4))),
            ),
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: eleves.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final e = eleves[i];
                  final c = _ctrl[toInt(e['eleve_id'])]!;
                  return Row(children: [
                    Expanded(
                        child: Text('${e['nom']} ${e['prenom']}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w600))),
                    SizedBox(
                      width: 110,
                      child: TextField(
                        controller: c,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        textAlign: TextAlign.center,
                        decoration: InputDecoration(
                            isDense: true,
                            hintText: '—',
                            suffixText: '/$bareme',
                            errorText: _check(c.text, bareme),
                            errorMaxLines: 2),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ]);
                },
              ),
            ),
            SafeArea(
                top: false,
                child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                    child: SizedBox(
                        width: double.infinity,
                        child: BusyButton(
                            busy: _busy,
                            onPressed: () => _save(d),
                            label: 'Enregistrer les notes',
                            icon: Icons.check)))),
          ]);
        },
      ),
    );
  }
}

class EvaluationFormPage extends StatefulWidget {
  const EvaluationFormPage({super.key});

  @override
  State<EvaluationFormPage> createState() => _EvaluationFormPageState();
}

class _EvaluationFormPageState extends State<EvaluationFormPage> {
  final _form = GlobalKey<FormState>();
  final _titre = TextEditingController();
  final _bareme = TextEditingController(text: '20');
  List<Map<String, dynamic>> _aff = [];
  int? _classe, _matiere;
  int _trimestre = 1;
  String _type = 'controle_continu';
  String _date = isoDate(DateTime.now());
  bool _loaded = false, _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAff();
  }

  Future<void> _loadAff() async {
    try {
      final a = await api.getList('/affectations');
      if (mounted) {
        setState(() {
          _aff = a;
          _loaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = errorText(e);
          _loaded = true;
        });
      }
    }
  }

  @override
  void dispose() {
    _titre.dispose();
    _bareme.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/evaluations', body: {
        'classe_id': _classe,
        'matiere_id': _matiere,
        'titre': _titre.text.trim(),
        'type': _type,
        'trimestre': _trimestre,
        'date_eval': _date,
        'bareme': parseDecimal(_bareme.text)
      });
      if (mounted) {
        showOk(context, 'Évaluation créée');
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final classes = <int, String>{};
    final matieres = <int, String>{};
    for (final a in _aff) {
      classes[toInt(a['classe_id'])] =
          '${a['classe_nom'] ?? a['classe'] ?? 'Classe ${a['classe_id']}'}';
      if (_classe == null || toInt(a['classe_id']) == _classe) {
        matieres[toInt(a['matiere_id'])] =
            '${a['matiere_nom'] ?? a['matiere'] ?? 'Matière ${a['matiere_id']}'}';
      }
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Nouvelle évaluation')),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorBox(message: _error!)
              : SafeArea(
                  child: Form(
                    key: _form,
                    child:
                        ListView(padding: const EdgeInsets.all(16), children: [
                      if (_aff.isEmpty)
                        const Padding(
                            padding: EdgeInsets.only(bottom: 12),
                            child: Text(
                                'Aucune affectation : la direction doit d\'abord vous affecter à une classe et une matière.',
                                style: TextStyle(color: AppColors.warn))),
                      dropdown<int>(
                          label: 'Classe *',
                          value: _classe,
                          items: classes,
                          onChanged: (v) => setState(() {
                                _classe = v;
                                _matiere = null;
                              }),
                          validator: (v) =>
                              v == null ? 'Choisissez une classe' : null),
                      const SizedBox(height: 12),
                      dropdown<int>(
                          label: 'Matière *',
                          value: _matiere,
                          items: matieres,
                          onChanged: (v) => setState(() => _matiere = v),
                          validator: (v) =>
                              v == null ? 'Choisissez une matière' : null),
                      const SizedBox(height: 12),
                      textField(_titre, 'Titre *',
                          validator: vRequired('Le titre', min: 2)),
                      const SizedBox(height: 12),
                      dropdown<String>(
                          label: 'Type',
                          value: _type,
                          items: const {
                            'controle_continu': 'Contrôle continu',
                            'examen_trimestriel': 'Examen trimestriel'
                          },
                          onChanged: (v) =>
                              setState(() => _type = v ?? 'controle_continu')),
                      const SizedBox(height: 12),
                      dropdown<int>(
                          label: 'Trimestre',
                          value: _trimestre,
                          items: const {
                            1: '1er trimestre',
                            2: '2ème trimestre',
                            3: '3ème trimestre'
                          },
                          onChanged: (v) =>
                              setState(() => _trimestre = v ?? 1)),
                      const SizedBox(height: 12),
                      textField(_bareme, 'Barème (note maximale) *',
                          keyboard: const TextInputType.numberWithOptions(
                              decimal: true),
                          validator: vMoney('Le barème', min: 1, max: 100)),
                      const SizedBox(height: 12),
                      PickerField(
                          label: 'Date *',
                          value: dateFr(_date),
                          onTap: () async {
                            final d = await pickDate(context, initial: _date);
                            if (d != null) setState(() => _date = d);
                          }),
                      const SizedBox(height: 22),
                      BusyButton(
                          busy: _busy,
                          onPressed: _aff.isEmpty ? null : _save,
                          label: 'Créer l\'évaluation'),
                    ]),
                  ),
                ),
    );
  }
}

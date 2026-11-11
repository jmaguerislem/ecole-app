import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'conflict_panel.dart';

/// Création / modification d'une séance.
/// Les règles (salle libre, enseignant libre, classe libre) sont vérifiées EN DIRECT par le serveur pendant la saisie,
/// puis revérifiées à l'enregistrement (création comme modification) : un conflit est toujours refusé.
class CreneauFormPage extends StatefulWidget {
  final Map<String, dynamic>? creneau;
  final int? classeId;
  final int? jour;
  final List<Map<String, dynamic>> classes, matieres, enseignants, salles;
  const CreneauFormPage(
      {super.key,
      this.creneau,
      this.classeId,
      this.jour,
      required this.classes,
      required this.matieres,
      required this.enseignants,
      required this.salles});

  @override
  State<CreneauFormPage> createState() => _CreneauFormPageState();
}

class _CreneauFormPageState extends State<CreneauFormPage> {
  final _form = GlobalKey<FormState>();
  bool get _edit => widget.creneau != null;
  int? _classe, _matiere, _enseignant, _salle;
  int _jour = 1;
  String? _debut, _fin;
  bool _busy = false;
  bool _checking = false;
  Timer? _timer;
  int _checkSeq = 0;

  // État de la vérification en direct
  bool? _ok;
  List<Map<String, dynamic>> _conflits = [],
      _sallesLibres = [],
      _creneauxLibres = [];
  String? _checkError;

  @override
  void initState() {
    super.initState();
    final c = widget.creneau;
    _classe = c != null ? toInt(c['classe_id']) : widget.classeId;
    _matiere = c != null ? toInt(c['matiere_id']) : null;
    _enseignant = c != null ? toInt(c['enseignant_id']) : null;
    _salle = c != null && c['salle_id'] != null ? toInt(c['salle_id']) : null;
    _jour = c != null ? toInt(c['jour']) : (widget.jour ?? 1);
    _debut = c != null ? hm(c['heure_debut']) : null;
    _fin = c != null ? hm(c['heure_fin']) : null;
    if (c != null) _scheduleCheck();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  bool get _complete =>
      _classe != null &&
      _matiere != null &&
      _enseignant != null &&
      _debut != null &&
      _fin != null;

  Map<String, dynamic> _body() => {
        if (_edit) 'id': widget.creneau!['id'],
        'classe_id': _classe,
        'matiere_id': _matiere,
        'enseignant_id': _enseignant,
        'salle_id': _salle,
        'jour': _jour,
        'heure_debut': _debut,
        'heure_fin': _fin,
      };

  void _changed(VoidCallback f) {
    setState(f);
    _scheduleCheck();
  }

  void _scheduleCheck() {
    _timer?.cancel();
    setState(() {
      _ok = null;
      _checkError = null;
    });
    if (!_complete) return;
    _timer = Timer(const Duration(milliseconds: 450), _check);
  }

  Future<void> _check() async {
    final seq = ++_checkSeq;
    setState(() => _checking = true);
    try {
      final r = asMap(await api.post('/creneaux/verifier', body: _body()));
      if (!mounted || seq != _checkSeq) return;
      setState(() {
        _ok = r['ok'] == true;
        _conflits = asList(r['conflits']);
        final s = asMap(r['suggestions']);
        _sallesLibres = asList(s['salles']);
        _creneauxLibres = asList(s['creneaux']);
      });
    } catch (e) {
      // Erreur de forme (ex. heure de fin avant le début) : message du serveur, sans bloquer la saisie.
      if (mounted && seq == _checkSeq)
        setState(() => _checkError = errorText(e));
    } finally {
      if (mounted && seq == _checkSeq) setState(() => _checking = false);
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (!_complete) {
      showError(context,
          ApiException(0, 'Renseignez les heures de début et de fin.'));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = _body()..remove('id');
      if (_edit) {
        await api.put('/creneaux/${widget.creneau!['id']}', body: body);
      } else {
        await api.post('/creneaux', body: body);
      }
      if (mounted) {
        showOk(context, _edit ? 'Séance modifiée' : 'Séance ajoutée');
        Navigator.pop(context, true);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isEdtConflict) {
        // Le serveur a refusé (par ex. un autre utilisateur vient de réserver ce créneau) : on affiche le détail.
        setState(() {
          _ok = false;
          _conflits = e.conflits;
          _sallesLibres = e.sallesLibres;
          _creneauxLibres = e.creneauxLibres;
        });
        showError(context, e);
      } else {
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<int, String> _map(List<Map<String, dynamic>> l,
          String Function(Map<String, dynamic>) label) =>
      {for (final e in l) toInt(e['id']): label(e)};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar:
          AppBar(title: Text(_edit ? 'Modifier la séance' : 'Nouvelle séance')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            dropdown<int>(
                label: 'Classe *',
                icon: Icons.class_outlined,
                value: _classe,
                items: _map(widget.classes, (c) => '${c['nom']}'),
                onChanged: (v) => _changed(() => _classe = v),
                validator: (v) => v == null ? 'Choisissez une classe' : null),
            const SizedBox(height: 12),
            dropdown<int>(
                label: 'Matière *',
                icon: Icons.menu_book_outlined,
                value: _matiere,
                items: _map(widget.matieres, (m) => '${m['nom']}'),
                onChanged: (v) => _changed(() => _matiere = v),
                validator: (v) => v == null ? 'Choisissez une matière' : null),
            const SizedBox(height: 12),
            dropdown<int>(
                label: 'Enseignant *',
                icon: Icons.person_outline,
                value: _enseignant,
                items: _map(
                    widget.enseignants,
                    (e) =>
                        '${e['nom_complet'] ?? '${e['prenom']} ${e['nom']}'}'),
                onChanged: (v) => _changed(() => _enseignant = v),
                validator: (v) =>
                    v == null ? 'Choisissez un enseignant' : null),
            const SizedBox(height: 12),
            dropdown<int?>(
              label: 'Salle',
              icon: Icons.meeting_room_outlined,
              value: _salle,
              items: {
                null: 'Sans salle',
                for (final s
                    in widget.salles.where((s) => s['disponible'] != false))
                  toInt(s['id']): '${s['nom']}'
              },
              onChanged: (v) => _changed(() => _salle = v),
            ),
            const SizedBox(height: 12),
            dropdown<int>(
                label: 'Jour *',
                icon: Icons.event,
                value: _jour,
                items: {for (var i = 1; i <= 6; i++) i: joursSemaine[i - 1]},
                onChanged: (v) => _changed(() => _jour = v ?? 1)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: PickerField(
                  label: 'Début *',
                  value: _debut,
                  icon: Icons.schedule,
                  onTap: () async {
                    final t =
                        await pickTime(context, initial: _debut ?? '08:00');
                    if (t != null) _changed(() => _debut = t);
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: PickerField(
                  label: 'Fin *',
                  value: _fin,
                  icon: Icons.schedule,
                  onTap: () async {
                    final t = await pickTime(context,
                        initial: _fin ?? _debut ?? '09:00');
                    if (t != null) _changed(() => _fin = t);
                  },
                ),
              ),
            ]),
            const SizedBox(height: 16),
            _status(),
            const SizedBox(height: 20),
            BusyButton(
                busy: _busy,
                onPressed: _ok == false ? null : _save,
                label: _edit ? 'Enregistrer' : 'Ajouter la séance'),
            if (_ok == false)
              const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                      'Corrigez le conflit ci-dessus pour pouvoir enregistrer.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.black54, fontSize: 12.5))),
          ]),
        ),
      ),
    );
  }

  Widget _status() {
    if (_checking) {
      return const Row(children: [
        SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2)),
        SizedBox(width: 10),
        Text('Vérification de la disponibilité…')
      ]);
    }
    if (_checkError != null) {
      return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.info_outline, color: AppColors.warn),
        const SizedBox(width: 8),
        Expanded(
            child: Text(_checkError!,
                style: const TextStyle(color: AppColors.warn)))
      ]);
    }
    if (_ok == true) {
      return const Row(children: [
        Icon(Icons.check_circle, color: AppColors.ok),
        SizedBox(width: 8),
        Expanded(
            child: Text(
                'Créneau disponible : salle, enseignant et classe sont libres.',
                style: TextStyle(
                    color: AppColors.ok, fontWeight: FontWeight.w600)))
      ]);
    }
    if (_ok == false) {
      return ConflictPanel(
        conflits: _conflits,
        salles: _sallesLibres,
        creneaux: _creneauxLibres,
        onPickRoom: (id) => _changed(() => _salle = id),
        onPickSlot: (j, d, f) => _changed(() {
          _jour = j;
          _debut = d;
          _fin = f;
        }),
      );
    }
    return const Text(
        'La disponibilité sera vérifiée automatiquement dès que tous les champs sont remplis.',
        style: TextStyle(color: Colors.black54, fontSize: 13));
  }
}

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../family/bulletin_page.dart';
import 'student_form_page.dart';

class StudentDetailPage extends StatefulWidget {
  final Map<String, dynamic> eleve;
  const StudentDetailPage({super.key, required this.eleve});

  @override
  State<StudentDetailPage> createState() => _StudentDetailPageState();
}

class _StudentDetailPageState extends State<StudentDetailPage> {
  int _version = 0;
  late Map<String, dynamic> _e = widget.eleve;

  Future<Map<String, dynamic>> _load() async {
    final id = _e['id'];
    final fresh = await api.getMap('/eleves/$id');
    _e = fresh;
    final parentIds = (fresh['parent_ids'] is List)
        ? (fresh['parent_ids'] as List).map((x) => '$x').toSet()
        : <String>{};
    List<Map<String, dynamic>> parents = [];
    if (parentIds.isNotEmpty) {
      final all = await api.getList('/users', query: {'role': 'parent'});
      parents = all.where((p) => parentIds.contains('${p['id']}')).toList();
    }
    Map<String, dynamic> solde = {};
    try {
      solde = await api.getMap('/paiements/solde/$id');
    } catch (_) {}
    return {'eleve': fresh, 'parents': parents, 'solde': solde};
  }

  Future<void> _resend(Map<String, dynamic> p) async {
    try {
      final r = asMap(await api.post('/users/${p['id']}/renvoyer-invitation'));
      if (!mounted) return;
      if (r['email_envoye'] == true) {
        showOk(context, 'E-mail renvoyé à ${p['email']}');
      } else {
        showError(
            context,
            ApiException(
                0, 'L\'e-mail n\'a pas pu être envoyé : ${r['erreur']}'));
      }
      setState(() => _version++);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = AuthScope.of(context).user?.role == 'admin';
    return Scaffold(
      appBar: AppBar(title: Text('${_e['prenom']} ${_e['nom']}')),
      body: AsyncView<Map<String, dynamic>>(
        key: ValueKey(_version),
        load: _load,
        builder: (context, d, reload) {
          final e = asMap(d['eleve']);
          final parents = asList(d['parents']);
          final solde = asMap(d['solde']);
          return ScrollPage(children: [
            SectionCard(
              title: 'Informations',
              child: Column(children: [
                InfoRow('Classe', str(e['classe_nom'])),
                InfoRow('Matricule', str(e['matricule'])),
                InfoRow('Naissance', dateFr(e['date_naissance'])),
                InfoRow(
                    'Sexe',
                    e['sexe'] == 'M'
                        ? 'Garçon'
                        : e['sexe'] == 'F'
                            ? 'Fille'
                            : null),
                InfoRow('Adresse', str(e['adresse'])),
                InfoRow('Statut', str(e['statut'])),
              ]),
            ),
            const SizedBox(height: 12),
            if (solde.isNotEmpty)
              SectionCard(
                title: 'Scolarité ${solde['annee_scolaire'] ?? ''}',
                child: Column(children: [
                  InfoRow('Total dû', money(solde['total_du'])),
                  InfoRow('Total payé', money(solde['total_paye'])),
                  Row(children: [
                    const SizedBox(
                        width: 120,
                        child: Text('Solde',
                            style: TextStyle(color: Colors.black54))),
                    toNum(solde['solde']) > 0
                        ? StatusChip(
                            '${money(solde['solde'])} à payer', AppColors.bad)
                        : const StatusChip('À jour', AppColors.ok,
                            icon: Icons.check_circle),
                  ]),
                ]),
              ),
            const SizedBox(height: 12),
            SectionCard(
              title: 'Parents',
              child: parents.isEmpty
                  ? const Text('Aucun parent rattaché.')
                  : Column(children: [
                      for (final p in parents)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${p['prenom']} ${p['nom']}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700)),
                                Text(
                                    '${p['email']}${str(p['telephone']).isEmpty ? '' : ' · ${p['telephone']}'}',
                                    style:
                                        const TextStyle(color: Colors.black54)),
                                const SizedBox(height: 6),
                                Wrap(
                                    spacing: 8,
                                    runSpacing: 6,
                                    crossAxisAlignment:
                                        WrapCrossAlignment.center,
                                    children: [
                                      if (p['mot_de_passe_defini'] == true)
                                        const StatusChip(
                                            'Compte activé', AppColors.ok,
                                            icon: Icons.verified_user)
                                      else
                                        const StatusChip(
                                            'En attente d\'activation',
                                            AppColors.warn,
                                            icon: Icons.hourglass_top),
                                      if (p['invitation_erreur'] != null)
                                        const StatusChip(
                                            'E-mail non envoyé', AppColors.bad,
                                            icon: Icons.mail_outline),
                                      if (isAdmin &&
                                          p['mot_de_passe_defini'] != true)
                                        TextButton.icon(
                                            onPressed: () => _resend(p),
                                            icon: const Icon(
                                                Icons.forward_to_inbox,
                                                size: 18),
                                            label: const Text(
                                                'Renvoyer l\'invitation')),
                                    ]),
                              ]),
                        ),
                    ]),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => BulletinPage(
                      eleveId: toInt(e['id']),
                      nom: '${e['prenom']} ${e['nom']}'))),
              icon: const Icon(Icons.assignment_outlined),
              label: const Text('Voir le bulletin'),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: () async {
                final ok = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                        builder: (_) => StudentFormPage(eleve: e)));
                if (ok == true) setState(() => _version++);
              },
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Modifier / ajouter un parent'),
            ),
          ]);
        },
      ),
    );
  }
}

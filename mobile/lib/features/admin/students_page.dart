import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/json.dart';
import '../../core/ui.dart';
import 'student_detail_page.dart';
import 'student_form_page.dart';

class StudentsPage extends StatefulWidget {
  const StudentsPage({super.key});

  @override
  State<StudentsPage> createState() => _StudentsPageState();
}

class _StudentsPageState extends State<StudentsPage> {
  String _q = '';
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => const StudentFormPage()));
          if (ok == true) setState(() => _version++);
        },
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Ajouter un élève'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(
                hintText: 'Rechercher (nom, prénom, matricule)',
                prefixIcon: Icon(Icons.search)),
            onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
          ),
        ),
        Expanded(
          child: AsyncView<List<Map<String, dynamic>>>(
            key: ValueKey(_version),
            load: () => api.getList('/eleves'),
            builder: (context, all, reload) {
              final list = all
                  .where((e) =>
                      _q.isEmpty ||
                      '${e['nom']} ${e['prenom']} ${e['matricule'] ?? ''}'
                          .toLowerCase()
                          .contains(_q))
                  .toList();
              if (list.isEmpty) {
                return ScrollPage(children: [
                  EmptyBox(
                      icon: Icons.groups_outlined,
                      text: all.isEmpty
                          ? 'Aucun élève. Touchez « Ajouter un élève ».'
                          : 'Aucun résultat.')
                ]);
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final e = list[i];
                  final actif = '${e['statut']}' == 'actif';
                  return Card(
                    child: ListTile(
                      leading: AvatarCircle(
                          '${str(e['prenom']).isEmpty ? '' : str(e['prenom'])[0]}${str(e['nom']).isEmpty ? '' : str(e['nom'])[0]}'
                              .toUpperCase()),
                      title: Text('${e['prenom']} ${e['nom']}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(
                          '${str(e['classe_nom']).isEmpty ? 'Sans classe' : e['classe_nom']}${str(e['matricule']).isEmpty ? '' : ' · ${e['matricule']}'}'),
                      trailing: actif
                          ? null
                          : StatusChip('${e['statut']}', Colors.black45),
                      onTap: () async {
                        await Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => StudentDetailPage(eleve: e)));
                        setState(() => _version++);
                      },
                    ),
                  );
                },
              );
            },
          ),
        ),
      ]),
    );
  }
}

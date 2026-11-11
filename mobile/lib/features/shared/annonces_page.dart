import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/ui.dart';

const _audiences = {
  'tous': 'Tout le monde',
  'parents': 'Les parents',
  'enseignants': 'Les enseignants',
  'eleves': 'Les élèves'
};

class AnnoncesPage extends StatefulWidget {
  final bool canPublish;
  const AnnoncesPage({super.key, this.canPublish = false});

  @override
  State<AnnoncesPage> createState() => _AnnoncesPageState();
}

class _AnnoncesPageState extends State<AnnoncesPage> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Annonces')),
      floatingActionButton: widget.canPublish
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await showSheet<bool>(
                    context, (_) => const _PublishSheet());
                if (ok == true) setState(() => _version++);
              },
              icon: const Icon(Icons.add),
              label: const Text('Publier'),
            )
          : null,
      body: AsyncView<List<Map<String, dynamic>>>(
        key: ValueKey(_version),
        load: () => api.getList('/annonces'),
        builder: (context, list, reload) {
          if (list.isEmpty)
            return ScrollPage(children: const [
              EmptyBox(icon: Icons.campaign_outlined, text: 'Aucune annonce.')
            ]);
          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final a = list[i];
              return SectionCard(
                title: str(a['titre']),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(str(a['corps']),
                          style: const TextStyle(height: 1.4)),
                      const SizedBox(height: 10),
                      Text(
                          '${str(a['auteur_nom'])} · ${dateTimeFr(a['created_at'])}',
                          style: const TextStyle(
                              color: Colors.black45, fontSize: 12)),
                    ]),
              );
            },
          );
        },
      ),
    );
  }
}

class _PublishSheet extends StatefulWidget {
  const _PublishSheet();

  @override
  State<_PublishSheet> createState() => _PublishSheetState();
}

class _PublishSheetState extends State<_PublishSheet> {
  final _form = GlobalKey<FormState>();
  final _titre = TextEditingController();
  final _corps = TextEditingController();
  String _aud = 'tous';
  bool _busy = false;

  @override
  void dispose() {
    _titre.dispose();
    _corps.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/annonces', body: {
        'titre': _titre.text.trim(),
        'corps': _corps.text.trim(),
        'audience': _aud
      });
      if (mounted) {
        showOk(context, 'Annonce publiée');
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
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Form(
        key: _form,
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Nouvelle annonce',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('Une annonce publiée ne peut plus être modifiée.',
              style: TextStyle(color: Colors.black54, fontSize: 12.5)),
          const SizedBox(height: 14),
          textField(_titre, 'Titre *',
              validator: vRequired('Le titre', min: 3), maxLength: 120),
          const SizedBox(height: 12),
          textField(_corps, 'Contenu *',
              validator: vRequired('Le contenu', min: 3),
              maxLines: 5,
              maxLength: 5000),
          const SizedBox(height: 12),
          dropdown<String>(
              label: 'Destinataires',
              value: _aud,
              items: _audiences,
              onChanged: (v) => setState(() => _aud = v ?? 'tous')),
          const SizedBox(height: 18),
          BusyButton(busy: _busy, onPressed: _save, label: 'Publier'),
        ]),
      ),
    );
  }
}

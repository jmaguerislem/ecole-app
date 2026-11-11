import 'dart:convert';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/auth_controller.dart';
import '../../core/forms.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'pickers.dart';

class MessagesPage extends StatefulWidget {
  const MessagesPage({super.key});

  @override
  State<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends State<MessagesPage> {
  int _version = 0;

  Future<void> _compose() async {
    final ok = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => const ComposePage()));
    if (ok == true) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
            title: const Text('Messagerie'),
            bottom:
                const TabBar(tabs: [Tab(text: 'Reçus'), Tab(text: 'Envoyés')])),
        floatingActionButton: FloatingActionButton.extended(
            onPressed: _compose,
            icon: const Icon(Icons.edit),
            label: const Text('Écrire')),
        body: TabBarView(children: [
          _Box(
              box: 'inbox',
              version: _version,
              onChanged: () => setState(() => _version++)),
          _Box(
              box: 'sent',
              version: _version,
              onChanged: () => setState(() => _version++)),
        ]),
      ),
    );
  }
}

class _Box extends StatelessWidget {
  final String box;
  final int version;
  final VoidCallback onChanged;
  const _Box(
      {required this.box, required this.version, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return AsyncView<List<Map<String, dynamic>>>(
      key: ValueKey('$box$version'),
      load: () => api.getList('/messages', query: {'box': box}),
      builder: (context, list, reload) {
        if (list.isEmpty)
          return ScrollPage(children: [
            EmptyBox(
                icon: Icons.mail_outline,
                text: box == 'inbox'
                    ? 'Aucun message reçu.'
                    : 'Aucun message envoyé.')
          ]);
        return ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final m = list[i];
            final unread = box == 'inbox' && m['read_at'] == null;
            return Card(
              child: ListTile(
                leading: AvatarCircle(box == 'inbox'
                    ? str(m['sender_nom'])
                        .split(' ')
                        .map((p) => p.isEmpty ? '' : p[0])
                        .take(2)
                        .join()
                        .toUpperCase()
                    : '→'),
                title: Text(str(m['objet']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight:
                            unread ? FontWeight.w800 : FontWeight.w600)),
                subtitle: Text(
                    '${box == 'inbox' ? str(m['sender_nom']) : 'À : ${str(m['destinataires_noms'])}'}\n${str(m['corps'])}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis),
                isThreeLine: true,
                trailing: Text(dateFr(m['sent_at']),
                    style:
                        const TextStyle(fontSize: 11, color: Colors.black45)),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => ThreadPage(messageId: toInt(m['id']))));
                  onChanged();
                },
              ),
            );
          },
        );
      },
    );
  }
}

class ThreadPage extends StatefulWidget {
  final int messageId;
  const ThreadPage({super.key, required this.messageId});

  @override
  State<ThreadPage> createState() => _ThreadPageState();
}

class _ThreadPageState extends State<ThreadPage> {
  final _reply = TextEditingController();
  int _version = 0;
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _send(Map<String, dynamic> d, int me) async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    final msgs = asList(d['messages']);
    final others = <int>{};
    for (final m in msgs) {
      if (toInt(m['sender_id']) != me) others.add(toInt(m['sender_id']));
      if (m['destinataires_ids'] is List) {
        for (final x in (m['destinataires_ids'] as List)) {
          if (toInt(x) != me) others.add(toInt(x));
        }
      }
    }
    if (others.isEmpty) {
      showError(
          context, ApiException(0, 'Aucun destinataire pour la réponse.'));
      return;
    }
    setState(() => _busy = true);
    try {
      await api.post('/messages', body: {
        'thread_id': d['thread'],
        'objet': str(msgs.first['objet']),
        'corps': text,
        'destinataires': jsonEncode(others.toList()),
        'brouillon': 'false'
      });
      _reply.clear();
      if (mounted) setState(() => _version++);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = AuthScope.of(context).user!.id;
    return Scaffold(
      appBar: AppBar(title: const Text('Conversation')),
      body: AsyncView<Map<String, dynamic>>(
        key: ValueKey(_version),
        load: () => api.getMap('/messages/${widget.messageId}'),
        builder: (context, d, reload) {
          final msgs = asList(d['messages']);
          return Column(children: [
            Expanded(
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Text(msgs.isEmpty ? '' : str(msgs.first['objet']),
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                for (final m in msgs)
                  Align(
                    alignment: toInt(m['sender_id']) == me
                        ? Alignment.centerRight
                        : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.82),
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                          color: toInt(m['sender_id']) == me
                              ? AppColors.brand.withValues(alpha: 0.1)
                              : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.black12)),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                                toInt(m['sender_id']) == me
                                    ? 'Moi'
                                    : str(m['sender_nom']),
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 12.5)),
                            const SizedBox(height: 4),
                            Text(str(m['corps']),
                                style: const TextStyle(height: 1.35)),
                            const SizedBox(height: 4),
                            Text(dateTimeFr(m['sent_at']),
                                style: const TextStyle(
                                    fontSize: 10.5, color: Colors.black45)),
                          ]),
                    ),
                  ),
              ]),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                child: Row(children: [
                  Expanded(
                      child: TextField(
                          controller: _reply,
                          minLines: 1,
                          maxLines: 4,
                          decoration:
                              const InputDecoration(hintText: 'Répondre…'))),
                  const SizedBox(width: 8),
                  IconButton.filled(
                      onPressed: _busy ? null : () => _send(d, me),
                      icon: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.send)),
                ]),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class ComposePage extends StatefulWidget {
  const ComposePage({super.key});

  @override
  State<ComposePage> createState() => _ComposePageState();
}

class _ComposePageState extends State<ComposePage> {
  final _form = GlobalKey<FormState>();
  final _objet = TextEditingController();
  final _corps = TextEditingController();
  final List<Map<String, dynamic>> _dest = [];
  bool _busy = false;

  @override
  void dispose() {
    _objet.dispose();
    _corps.dispose();
    super.dispose();
  }

  Future<void> _addRecipient() async {
    try {
      final all = await api.getList('/messages/destinataires');
      if (!mounted) return;
      final chosen = {for (final d in _dest) toInt(d['id'])};
      final r = await pickFromList(context,
          title: 'Destinataire',
          items: all.where((x) => !chosen.contains(toInt(x['id']))).toList(),
          label: (x) => '${x['prenom']} ${x['nom']}',
          subtitle: (x) => [UserRoleLabel.of('${x['role']}'), str(x['info'])]
              .where((s) => s.isNotEmpty)
              .join(' · '));
      if (r != null) setState(() => _dest.add(r));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _send() async {
    if (_dest.isEmpty) {
      showError(
          context, ApiException(0, 'Choisissez au moins un destinataire.'));
      return;
    }
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await api.post('/messages', body: {
        'objet': _objet.text.trim(),
        'corps': _corps.text.trim(),
        'destinataires': jsonEncode(_dest.map((d) => toInt(d['id'])).toList()),
        'brouillon': 'false'
      });
      if (mounted) {
        showOk(context, 'Message envoyé');
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
    return Scaffold(
      appBar: AppBar(title: const Text('Nouveau message')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Wrap(spacing: 8, runSpacing: 6, children: [
              for (final d in _dest)
                InputChip(
                    label: Text('${d['prenom']} ${d['nom']}'),
                    onDeleted: () => setState(() => _dest.remove(d))),
              ActionChip(
                  avatar: const Icon(Icons.person_add_alt, size: 18),
                  label: const Text('Ajouter un destinataire'),
                  onPressed: _addRecipient),
            ]),
            const SizedBox(height: 14),
            textField(_objet, 'Objet *',
                validator: vRequired('L\'objet'), maxLength: 150),
            const SizedBox(height: 12),
            textField(_corps, 'Message *',
                validator: vRequired('Le message'),
                maxLines: 8,
                maxLength: 5000),
            const SizedBox(height: 16),
            BusyButton(
                busy: _busy,
                onPressed: _send,
                label: 'Envoyer',
                icon: Icons.send),
          ]),
        ),
      ),
    );
  }
}

class UserRoleLabel {
  static String of(String role) => AppUser.roleLabels[role] ?? role;
}

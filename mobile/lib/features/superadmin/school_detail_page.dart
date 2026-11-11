import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import 'contract_form_page.dart';
import 'pay_rent_sheet.dart';
import 'sa_common.dart';
import 'school_form_page.dart';

/// Détail d'une école : informations, contrat de location, finances.
class SchoolDetailPage extends StatefulWidget {
  final int schoolId;
  const SchoolDetailPage({super.key, required this.schoolId});

  @override
  State<SchoolDetailPage> createState() => _SchoolDetailPageState();
}

class _SchoolDetailPageState extends State<SchoolDetailPage> {
  int _version = 0;
  void _refresh() => setState(() => _version++);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fiche de l\'école')),
      body: AsyncView<Map<String, dynamic>>(
        key: ValueKey(_version),
        load: () => api.getMap('/saas/schools/${widget.schoolId}'),
        builder: (context, d, reload) {
          final e = asMap(d['ecole']);
          return DefaultTabController(
            length: 3,
            child: Column(children: [
              Container(
                width: double.infinity,
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${e['label']}',
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w800)),
                      const TabBar(tabs: [
                        Tab(text: 'Informations'),
                        Tab(text: 'Contrat'),
                        Tab(text: 'Finances')
                      ]),
                    ]),
              ),
              Expanded(
                child: TabBarView(children: [
                  _InfoTab(data: d, onChanged: _refresh),
                  _ContractTab(data: d, onChanged: _refresh),
                  _FinanceTab(data: d, onChanged: _refresh),
                ]),
              ),
            ]),
          );
        },
      ),
    );
  }
}

class _InfoTab extends StatelessWidget {
  final Map<String, dynamic> data;
  final VoidCallback onChanged;
  const _InfoTab({required this.data, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final e = asMap(data['ecole']);
    final comptes = asMap(data['comptes']);
    final directeurs = asList(data['directeurs']);
    final active = '${e['status']}' != 'suspended';
    return ScrollPage(children: [
      SectionCard(
        title: 'Établissement',
        trailing: schoolStatusChip(e),
        child: Column(children: [
          InfoRow('Nom', '${e['nom']}'),
          InfoRow('Ville', str(e['ville'])),
          InfoRow('Adresse', str(e['adresse'])),
          InfoRow('Téléphone', str(e['telephone'])),
          InfoRow('E-mail', str(e['email_contact'])),
          InfoRow('Site (local)', str(e['site'])),
          InfoRow('Formule', planLabels['${e['plan']}'] ?? '${e['plan']}'),
          InfoRow(
              'Abonnement',
              e['subscription_end'] == null
                  ? 'Sans date de fin'
                  : 'Jusqu\'au ${dateFr(e['subscription_end'])}'),
          InfoRow('Identifiant', '${e['slug']}'),
        ]),
      ),
      const SizedBox(height: 12),
      StatGrid(tiles: [
        StatTile(
            icon: Icons.groups,
            label: 'Élèves',
            value: '${toInt(e['nb_eleves'])}',
            color: AppColors.info),
        StatTile(
            icon: Icons.class_,
            label: 'Classes',
            value: '${toInt(data['classes'])}'),
        StatTile(
            icon: Icons.co_present,
            label: 'Enseignants',
            value: '${toInt(comptes['enseignant'])}',
            color: AppColors.warn),
        StatTile(
            icon: Icons.family_restroom,
            label: 'Parents',
            value: '${toInt(comptes['parent'])}',
            color: AppColors.ok),
      ]),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Direction',
        child: directeurs.isEmpty
            ? const Text('Aucun compte de direction.')
            : Column(children: [
                for (final d in directeurs)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: AvatarCircle(
                        '${str(d['prenom']).isEmpty ? '' : str(d['prenom'])[0]}${str(d['nom']).isEmpty ? '' : str(d['nom'])[0]}'
                            .toUpperCase()),
                    title: Text('${d['prenom']} ${d['nom']}'),
                    subtitle: Text('${d['email']}'),
                    trailing: d['actif'] == true
                        ? null
                        : const StatusChip('Inactif', AppColors.bad),
                  ),
              ]),
      ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: () async {
          final ok = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => SchoolFormPage(school: e)));
          if (ok == true) onChanged();
        },
        icon: const Icon(Icons.edit_outlined),
        label: const Text('Modifier les informations'),
      ),
      const SizedBox(height: 10),
      FilledButton.icon(
        style: FilledButton.styleFrom(
            backgroundColor: active ? AppColors.bad : AppColors.ok),
        onPressed: () async {
          final ok = await confirm(
            context,
            active ? 'Désactiver l\'école ?' : 'Activer l\'école ?',
            active
                ? 'Les utilisateurs de cette école ne pourront plus se connecter. Les données sont conservées.'
                : 'Les utilisateurs de cette école pourront se reconnecter.',
            action: active ? 'Désactiver' : 'Activer',
            danger: active,
          );
          if (!ok) return;
          try {
            await api.put('/saas/schools/${e['id']}',
                body: {'status': active ? 'suspended' : 'active'});
            if (context.mounted)
              showOk(context, active ? 'École désactivée' : 'École activée');
            onChanged();
          } catch (err) {
            if (context.mounted) showError(context, err);
          }
        },
        icon: Icon(active ? Icons.block : Icons.check_circle_outline),
        label: Text(active ? 'Désactiver l\'école' : 'Activer l\'école'),
      ),
    ]);
  }
}

class _ContractTab extends StatelessWidget {
  final Map<String, dynamic> data;
  final VoidCallback onChanged;
  const _ContractTab({required this.data, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final e = asMap(data['ecole']);
    final c = data['contrat'] == null ? null : asMap(data['contrat']);
    Future<void> edit() async {
      final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
          builder: (_) =>
              ContractFormPage(schoolId: toInt(e['id']), contrat: c)));
      if (ok == true) onChanged();
    }

    if (c == null) {
      return ScrollPage(children: [
        const EmptyBox(
            icon: Icons.description_outlined,
            text:
                'Aucun contrat de location défini pour cette école.\nDéfinissez le loyer pour suivre les échéances et les encaissements.'),
        FilledButton.icon(
            onPressed: edit,
            icon: const Icon(Icons.add),
            label: const Text('Définir le contrat de location')),
      ]);
    }
    return ScrollPage(children: [
      SectionCard(
        title: 'Contrat de location',
        child: Column(children: [
          InfoRow('Loyer mensuel', money(c['loyer_mensuel'])),
          InfoRow('Échéance', 'Le ${c['jour_echeance']} de chaque mois'),
          InfoRow('Début', dateFr(c['date_debut'])),
          InfoRow(
              'Fin',
              c['date_fin'] == null
                  ? 'Durée indéterminée'
                  : dateFr(c['date_fin'])),
          InfoRow('Caution', c['caution'] == null ? null : money(c['caution'])),
          InfoRow('Notes', str(c['notes'])),
        ]),
      ),
      const SizedBox(height: 12),
      const Text(
          'Modifier le loyer ne change que les mois à venir sans versement : l\'historique des paiements reste intact.',
          style: TextStyle(color: Colors.black54, fontSize: 12.5)),
      const SizedBox(height: 14),
      OutlinedButton.icon(
          onPressed: edit,
          icon: const Icon(Icons.edit_outlined),
          label: const Text('Modifier le contrat')),
    ]);
  }
}

class _FinanceTab extends StatelessWidget {
  final Map<String, dynamic> data;
  final VoidCallback onChanged;
  const _FinanceTab({required this.data, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final fin = data['finance'] == null ? null : asMap(data['finance']);
    if (fin == null) {
      return ScrollPage(children: const [
        EmptyBox(
            icon: Icons.payments_outlined,
            text:
                'Définissez d\'abord le contrat de location (onglet « Contrat ») pour suivre les finances de cette école.')
      ]);
    }
    final t = asMap(fin['totaux']);
    final echeances = asList(fin['echeances']).reversed.toList();
    final histo = asList(fin['historique']);
    final e = asMap(data['ecole']);
    return ScrollPage(children: [
      StatGrid(tiles: [
        StatTile(
            icon: Icons.savings,
            label: 'Encaissé (réel)',
            value: moneyShort(t['encaisse']),
            color: AppColors.ok),
        StatTile(
            icon: Icons.event_note,
            label: 'Prévu',
            value: moneyShort(t['prevu']),
            color: AppColors.brand),
        StatTile(
            icon: Icons.error,
            label: 'Impayés (en retard)',
            value: moneyShort(t['impaye']),
            color: AppColors.bad),
        StatTile(
            icon: Icons.schedule,
            label: 'En attente',
            value: moneyShort(t['en_attente']),
            color: AppColors.warn),
      ]),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Échéances',
        child: echeances.isEmpty
            ? const Text('Aucune échéance.')
            : Column(children: [
                for (final ec in echeances)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(moisAnnee(ec['periode']),
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(
                        'Échéance le ${dateFr(ec['echeance'])}\nPayé ${money(ec['paye'])} sur ${money(ec['montant_du'])}'),
                    isThreeLine: true,
                    trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          loyerChip('${ec['statut']}',
                              partiel: ec['partiel'] == true),
                          if (toNum(ec['reste']) > 0)
                            InkWell(
                              onTap: () async {
                                final ok = await showSheet<bool>(
                                    context,
                                    (_) => PayRentSheet(
                                        echeance: ec, ecole: '${e['label']}'));
                                if (ok == true) onChanged();
                              },
                              child: const Padding(
                                  padding: EdgeInsets.only(top: 6),
                                  child: Text('Encaisser',
                                      style: TextStyle(
                                          color: AppColors.info,
                                          fontWeight: FontWeight.w700))),
                            ),
                        ]),
                  ),
              ]),
      ),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Historique des paiements',
        child: histo.isEmpty
            ? const Text('Aucun paiement encaissé pour l\'instant.')
            : Column(children: [
                for (final p in histo)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading:
                        const Icon(Icons.check_circle, color: AppColors.ok),
                    title: Text(
                        '${money(p['montant'])} · ${modeLabels['${p['mode']}'] ?? p['mode']}'),
                    subtitle: Text(
                        'Loyer de ${moisAnnee(p['periode'])}${str(p['reference']).isEmpty ? '' : ' · réf. ${p['reference']}'}'),
                    trailing: Text(dateFr(p['date_paiement']),
                        style: const TextStyle(
                            color: Colors.black54, fontSize: 12)),
                  ),
              ]),
      ),
    ]);
  }
}

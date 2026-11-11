import 'package:flutter/material.dart';

import 'api_client.dart';
import 'format.dart';
import 'theme.dart';

/// Message d'erreur lisible (jamais de trace technique affichée à l'utilisateur).
String errorText(Object e) =>
    e is ApiException ? e.message : 'Une erreur est survenue. Réessayez.';

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
        content: Text(errorText(e)),
        backgroundColor: AppColors.bad,
        duration: const Duration(seconds: 5)));
}

void showOk(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
        SnackBar(content: Text(message), backgroundColor: AppColors.ok));
}

Future<bool> confirm(BuildContext context, String title, String message,
    {String action = 'Confirmer', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Annuler')),
        FilledButton(
          style: danger
              ? FilledButton.styleFrom(backgroundColor: AppColors.bad)
              : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return r == true;
}

Future<T?> showSheet<T>(
    BuildContext context, Widget Function(BuildContext) builder) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (c) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
        child: builder(c)),
  );
}

/// Charge des données asynchrones : spinner, erreur avec « Réessayer », tirer pour actualiser.
class AsyncView<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(
      BuildContext context, T data, Future<void> Function() reload) builder;
  const AsyncView({super.key, required this.load, required this.builder});

  @override
  State<AsyncView<T>> createState() => _AsyncViewState<T>();
}

class _AsyncViewState<T> extends State<AsyncView<T>> {
  late Future<T> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.load();
  }

  Future<void> _reload() async {
    final f = widget.load();
    setState(() => _future = f);
    try {
      await f;
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return ErrorBox(message: errorText(snap.error!), onRetry: _reload);
        }
        return RefreshIndicator(
            onRefresh: _reload,
            child: widget.builder(context, snap.data as T, _reload));
      },
    );
  }
}

class ErrorBox extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const ErrorBox({super.key, required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off_rounded, size: 48, color: AppColors.bad),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          if (onRetry != null) ...[
            const SizedBox(height: 16),
            FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Réessayer')),
          ],
        ]),
      ),
    );
  }
}

class EmptyBox extends StatelessWidget {
  final IconData icon;
  final String text;
  const EmptyBox(
      {super.key, this.icon = Icons.inbox_outlined, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 44, color: Colors.black26),
        const SizedBox(height: 10),
        Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.black54)),
      ]),
    );
  }
}

/// Liste défilante toujours « tirable » (même vide) pour que RefreshIndicator fonctionne.
class ScrollPage extends StatelessWidget {
  final List<Widget> children;
  final EdgeInsets padding;
  const ScrollPage(
      {super.key,
      required this.children,
      this.padding = const EdgeInsets.all(16)});

  @override
  Widget build(BuildContext context) {
    return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: padding,
        children: children);
  }
}

class SectionCard extends StatelessWidget {
  final String? title;
  final Widget child;
  final Widget? trailing;
  final EdgeInsets padding;
  const SectionCard(
      {super.key,
      this.title,
      required this.child,
      this.trailing,
      this.padding = const EdgeInsets.all(16)});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(children: [
                Expanded(
                    child: Text(title!,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700))),
                if (trailing != null) trailing!,
              ]),
            ),
          child,
        ]),
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final Color color;
  final String? hint;
  const StatTile(
      {super.key,
      required this.icon,
      required this.label,
      required this.value,
      this.color = AppColors.brand,
      this.hint});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: 10),
          FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value,
                  style: const TextStyle(
                      fontSize: 22, fontWeight: FontWeight.w800))),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(color: Colors.black54, fontSize: 13)),
          if (hint != null)
            Text(hint!,
                style: TextStyle(
                    color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

/// Grille 2 colonnes de StatTile qui s'adapte à la hauteur de son contenu.
class StatGrid extends StatelessWidget {
  final List<Widget> tiles;
  const StatGrid({super.key, required this.tiles});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Expanded(child: tiles[i]),
        const SizedBox(width: 12),
        Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
      ]));
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 12));
    }
    return Column(children: rows);
  }
}

class StatusChip extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;
  const StatusChip(this.label, this.color, {super.key, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4)
        ],
        Text(label,
            style: TextStyle(
                color: color, fontWeight: FontWeight.w700, fontSize: 12)),
      ]),
    );
  }
}

/// Indicateur visuel du loyer : payé / en attente / en retard (jamais confondus).
StatusChip loyerChip(String statut, {bool partiel = false}) {
  switch (statut) {
    case 'paye':
      return const StatusChip('Payé', AppColors.ok, icon: Icons.check_circle);
    case 'en_retard':
      return StatusChip(
          partiel ? 'En retard (partiel)' : 'En retard', AppColors.bad,
          icon: Icons.error);
    default:
      return StatusChip(
          partiel ? 'En attente (partiel)' : 'En attente', AppColors.warn,
          icon: Icons.schedule);
  }
}

Color loyerColor(String statut) => statut == 'paye'
    ? AppColors.ok
    : statut == 'en_retard'
        ? AppColors.bad
        : AppColors.warn;

class InfoRow extends StatelessWidget {
  final String label;
  final String? value;
  const InfoRow(this.label, this.value, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
            width: 120,
            child: Text(label, style: const TextStyle(color: Colors.black54))),
        Expanded(
            child: Text((value == null || value!.isEmpty) ? '—' : value!,
                style: const TextStyle(fontWeight: FontWeight.w600))),
      ]),
    );
  }
}

class AvatarCircle extends StatelessWidget {
  final String text;
  final double size;
  const AvatarCircle(this.text, {super.key, this.size = 40});

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: AppColors.brand.withValues(alpha: 0.12),
      child: Text(text,
          style: TextStyle(
              color: AppColors.brand,
              fontWeight: FontWeight.w800,
              fontSize: size * 0.36)),
    );
  }
}

/// Bouton principal avec indicateur de chargement (empêche le double envoi).
class BusyButton extends StatelessWidget {
  final bool busy;
  final VoidCallback? onPressed;
  final String label;
  final IconData? icon;
  const BusyButton(
      {super.key,
      required this.busy,
      required this.onPressed,
      required this.label,
      this.icon});

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                  strokeWidth: 2.5, color: Colors.white))
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                  if (icon != null) ...[
                    Icon(icon, size: 18),
                    const SizedBox(width: 8)
                  ],
                  Text(label),
                ]),
    );
  }
}

// ------------------------------------------------------------------ Graphiques (dessinés sans dépendance)

class BarGroup {
  final String label;
  final double a, b; // a = prévu, b = encaissé
  const BarGroup(this.label, this.a, this.b);
}

/// Histogramme groupé : barres claires = prévu, barres pleines = réellement encaissé.
class GroupedBarChart extends StatelessWidget {
  final List<BarGroup> groups;
  final String labelA, labelB;
  final Color colorA, colorB;
  final double height;
  const GroupedBarChart({
    super.key,
    required this.groups,
    this.labelA = 'Prévu',
    this.labelB = 'Encaissé',
    this.colorA = const Color(0xFFB8C4E0),
    this.colorB = AppColors.ok,
    this.height = 170,
  });

  @override
  Widget build(BuildContext context) {
    final maxV = groups.fold<double>(
        0, (m, g) => [m, g.a, g.b].reduce((x, y) => x > y ? x : y));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        _legend(colorA, labelA),
        const SizedBox(width: 16),
        _legend(colorB, labelB)
      ]),
      const SizedBox(height: 10),
      SizedBox(
        height: height + 22,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            for (final g in groups)
              Container(
                width: 46,
                margin: const EdgeInsets.symmetric(horizontal: 2),
                child:
                    Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                  SizedBox(
                    height: height,
                    child: Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          _bar(g.a, maxV, colorA),
                          const SizedBox(width: 3),
                          _bar(g.b, maxV, colorB),
                        ]),
                  ),
                  const SizedBox(height: 4),
                  Text(g.label,
                      style:
                          const TextStyle(fontSize: 10, color: Colors.black54)),
                ]),
              ),
          ]),
        ),
      ),
      if (maxV > 0)
        Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('Maximum : ${moneyShort(maxV)}',
                style: const TextStyle(fontSize: 11, color: Colors.black45))),
    ]);
  }

  Widget _bar(double v, double maxV, Color c) {
    final h = maxV <= 0 ? 0.0 : (v / maxV) * height;
    return Tooltip(
        message: moneyShort(v),
        child: Container(
            width: 15,
            height: v > 0 && h < 3 ? 3 : h,
            decoration: BoxDecoration(
                color: c,
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(4)))));
  }

  Widget _legend(Color c, String t) => Row(children: [
        Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
                color: c, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(t, style: const TextStyle(fontSize: 12)),
      ]);
}

class HBarItem {
  final String label;
  final double value;
  final String valueText;
  final Color color;
  const HBarItem(this.label, this.value, this.valueText, this.color);
}

/// Barres horizontales de comparaison (une ligne par école).
class HBarList extends StatelessWidget {
  final List<HBarItem> items;
  const HBarList({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    final maxV = items.fold<double>(0, (m, i) => i.value > m ? i.value : m);
    return Column(children: [
      for (final i in items)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                  child: Text(i.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600))),
              Text(i.valueText,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 5),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                  value: maxV <= 0 ? 0 : i.value / maxV,
                  minHeight: 10,
                  color: i.color,
                  backgroundColor: i.color.withValues(alpha: 0.12)),
            ),
          ]),
        ),
    ]);
  }
}

/// Barre segmentée payé / en attente / en retard.
class StatusBar extends StatelessWidget {
  final double paye, attente, retard;
  const StatusBar(
      {super.key,
      required this.paye,
      required this.attente,
      required this.retard});

  @override
  Widget build(BuildContext context) {
    final total = paye + attente + retard;
    if (total <= 0) return const SizedBox();
    int f(double v) => (v / total * 1000).round().clamp(0, 1000);
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        height: 14,
        child: Row(children: [
          if (paye > 0)
            Expanded(flex: f(paye), child: Container(color: AppColors.ok)),
          if (attente > 0)
            Expanded(flex: f(attente), child: Container(color: AppColors.warn)),
          if (retard > 0)
            Expanded(flex: f(retard), child: Container(color: AppColors.bad)),
        ]),
      ),
    );
  }
}

/// Sélecteur de date (calendrier en français) : renvoie 'YYYY-MM-DD'.
Future<String?> pickDate(BuildContext context,
    {String? initial, DateTime? first, DateTime? last}) async {
  final now = DateTime.now();
  final init = DateTime.tryParse(initial ?? '') ?? now;
  final d = await showDatePicker(
    context: context,
    initialDate: init,
    firstDate: first ?? DateTime(now.year - 5),
    lastDate: last ?? DateTime(now.year + 6),
    locale: const Locale('fr'),
  );
  return d == null ? null : isoDate(d);
}

/// Sélecteur d'heure 24 h : renvoie 'HH:MM'.
Future<String?> pickTime(BuildContext context, {String? initial}) async {
  final p = (initial ?? '08:00').split(':');
  final t = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(
        hour: int.tryParse(p[0]) ?? 8,
        minute: int.tryParse(p.length > 1 ? p[1] : '0') ?? 0),
    builder: (c, w) => MediaQuery(
        data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: true),
        child: w!),
  );
  return t == null
      ? null
      : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

/// Champ cliquable qui ouvre un sélecteur (date/heure) et affiche la valeur.
class PickerField extends StatelessWidget {
  final String label;
  final String? value;
  final IconData icon;
  final VoidCallback onTap;
  final String? errorText;
  const PickerField(
      {super.key,
      required this.label,
      required this.value,
      required this.onTap,
      this.icon = Icons.calendar_today,
      this.errorText});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
            labelText: label,
            suffixIcon: Icon(icon, size: 20),
            errorText: errorText),
        child: Text(value == null || value!.isEmpty ? 'Choisir…' : value!,
            style: TextStyle(
                color:
                    value == null || value!.isEmpty ? Colors.black45 : null)),
      ),
    );
  }
}

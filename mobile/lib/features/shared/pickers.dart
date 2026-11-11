import 'package:flutter/material.dart';

import '../../core/ui.dart';

/// Sélecteur dans une longue liste, avec recherche (élèves, parents…).
Future<Map<String, dynamic>?> pickFromList(BuildContext context,
    {required String title,
    required List<Map<String, dynamic>> items,
    required String Function(Map<String, dynamic>) label,
    String Function(Map<String, dynamic>)? subtitle}) {
  return showSheet<Map<String, dynamic>>(
      context,
      (c) => _PickerBody(
          title: title, items: items, label: label, subtitle: subtitle));
}

class _PickerBody extends StatefulWidget {
  final String title;
  final List<Map<String, dynamic>> items;
  final String Function(Map<String, dynamic>) label;
  final String Function(Map<String, dynamic>)? subtitle;
  const _PickerBody(
      {required this.title,
      required this.items,
      required this.label,
      this.subtitle});

  @override
  State<_PickerBody> createState() => _PickerBodyState();
}

class _PickerBodyState extends State<_PickerBody> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final list = widget.items
        .where((e) => widget.label(e).toLowerCase().contains(_q))
        .toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.7,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Column(children: [
            Text(widget.title,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            TextField(
                autofocus: false,
                decoration: const InputDecoration(
                    hintText: 'Rechercher…', prefixIcon: Icon(Icons.search)),
                onChanged: (v) => setState(() => _q = v.trim().toLowerCase())),
          ]),
        ),
        Expanded(
          child: list.isEmpty
              ? const EmptyBox(text: 'Aucun résultat')
              : ListView.builder(
                  itemCount: list.length,
                  itemBuilder: (c, i) => ListTile(
                    title: Text(widget.label(list[i])),
                    subtitle: widget.subtitle == null
                        ? null
                        : Text(widget.subtitle!(list[i])),
                    onTap: () => Navigator.pop(context, list[i]),
                  ),
                ),
        ),
      ]),
    );
  }
}

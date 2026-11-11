import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Champ de formulaire standard de l'application.
Widget textField(
  TextEditingController c,
  String label, {
  String? Function(String?)? validator,
  TextInputType? keyboard,
  bool obscure = false,
  int maxLines = 1,
  String? helper,
  IconData? icon,
  TextInputAction? action,
  TextCapitalization capitalization = TextCapitalization.none,
  List<TextInputFormatter>? formatters,
  int? maxLength,
  bool enabled = true,
}) {
  return TextFormField(
    controller: c,
    keyboardType: keyboard,
    obscureText: obscure,
    maxLines: obscure ? 1 : maxLines,
    maxLength: maxLength,
    enabled: enabled,
    textInputAction: action,
    textCapitalization: capitalization,
    inputFormatters: formatters,
    validator: validator,
    decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        counterText: '',
        prefixIcon: icon == null ? null : Icon(icon)),
  );
}

/// Liste déroulante (valeur -> libellé).
Widget dropdown<T>(
    {required String label,
    required T? value,
    required Map<T, String> items,
    required ValueChanged<T?> onChanged,
    String? Function(T?)? validator,
    IconData? icon}) {
  return DropdownButtonFormField<T>(
    key: ValueKey('$label|$value'),
    initialValue: items.containsKey(value) ? value : null,
    isExpanded: true,
    decoration: InputDecoration(
        labelText: label, prefixIcon: icon == null ? null : Icon(icon)),
    items: [
      for (final e in items.entries)
        DropdownMenuItem<T>(
            value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))
    ],
    onChanged: onChanged,
    validator: validator,
  );
}

double? parseDecimal(String s) => double.tryParse(
    s.trim().replaceAll(' ', '').replaceAll('\u202F', '').replaceAll(',', '.'));

String? Function(String?) vRequired(String label, {int min = 1}) => (v) {
      final t = (v ?? '').trim();
      if (t.isEmpty) return '$label est obligatoire';
      if (t.length < min) return '$label : $min caractères minimum';
      return null;
    };

String? vEmail(String? v, {bool required = true}) {
  final t = (v ?? '').trim();
  if (t.isEmpty) return required ? 'L\'adresse e-mail est obligatoire' : null;
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$').hasMatch(t)
      ? null
      : 'Adresse e-mail invalide';
}

String? vPhone8(String? v, {bool required = false}) {
  final t = (v ?? '').replaceAll(RegExp(r'[\s.-]'), '');
  if (t.isEmpty) return required ? 'Le téléphone est obligatoire' : null;
  return RegExp(r'^\d{8}$').hasMatch(t)
      ? null
      : 'Le téléphone comporte 8 chiffres';
}

String? Function(String?) vMoney(String label,
        {bool required = true, double min = 0, double? max}) =>
    (v) {
      final t = (v ?? '').trim();
      if (t.isEmpty) return required ? '$label est obligatoire' : null;
      final n = parseDecimal(t);
      if (n == null) return '$label : nombre invalide';
      if (n < min)
        return '$label doit être supérieur ou égal à ${min.toStringAsFixed(0)}';
      if (max != null && n > max)
        return '$label ne peut pas dépasser ${max.toStringAsFixed(0)}';
      return null;
    };

/// Corps JSON : champs vides -> null (le serveur les traite comme « non renseigné »).
String? orNull(TextEditingController c) {
  final t = c.text.trim();
  return t.isEmpty ? null : t;
}

/// Formats d'affichage (français / Tunisie). Les montants sont en dinars tunisiens (TND).
const joursSemaine = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi'
];
const moisNoms = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
];
const moisCourts = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.'
];

num toNum(dynamic v) => v is num ? v : (num.tryParse('${v ?? ''}') ?? 0);
int toInt(dynamic v) => toNum(v).toInt();

String nombre(num v, {int decimales = 2}) {
  final neg = v < 0;
  final s = v.abs().toStringAsFixed(decimales);
  final parts = s.split('.');
  final ent = parts[0];
  final buf = StringBuffer();
  for (var i = 0; i < ent.length; i++) {
    if (i > 0 && (ent.length - i) % 3 == 0) buf.write('\u202F');
    buf.write(ent[i]);
  }
  final dec = parts.length > 1 ? ',${parts[1]}' : '';
  return '${neg ? '-' : ''}$buf$dec';
}

String money(dynamic v) => '${nombre(toNum(v))} TND';
String moneyShort(dynamic v) {
  final n = toNum(v);
  return '${nombre(n, decimales: n == n.roundToDouble() ? 0 : 2)} TND';
}

String _p(int n) => n.toString().padLeft(2, '0');

/// '2026-11-09' ou '2026-11-09T10:00:00Z' -> '09/11/2026'
String dateFr(dynamic iso) {
  final s = '${iso ?? ''}';
  if (s.length < 10) return '—';
  if (s.contains('T')) {
    final d = DateTime.tryParse(s)?.toLocal();
    if (d != null) return '${_p(d.day)}/${_p(d.month)}/${d.year}';
  }
  return '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}';
}

String dateTimeFr(dynamic iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '—';
  return '${_p(d.day)}/${_p(d.month)}/${d.year} ${_p(d.hour)}:${_p(d.minute)}';
}

String moisAnnee(dynamic iso) {
  final s = '${iso ?? ''}';
  if (s.length < 7) return '—';
  final m = int.tryParse(s.substring(5, 7)) ?? 1;
  return '${moisNoms[(m - 1).clamp(0, 11)]} ${s.substring(0, 4)}';
}

String hm(dynamic t) {
  final s = '${t ?? ''}';
  return s.length >= 5 ? s.substring(0, 5) : s;
}

String isoDate(DateTime d) => '${d.year}-${_p(d.month)}-${_p(d.day)}';

String pluriel(int n, String singulier, [String? plur]) =>
    '$n ${n > 1 ? (plur ?? '${singulier}s') : singulier}';

/// Écran visé par une notification. Le serveur envoie le même `lien` au site web et à l'application
/// (ex. « /messagerie/12 ») : ce fichier le traduit en écran mobile. Pur Dart (aucun widget) pour être testable.
enum LienType { message, messagerie, annonces, notifications }

class LienCible {
  final LienType type;
  final int? id;
  const LienCible(this.type, [this.id]);

  @override
  bool operator ==(Object o) => o is LienCible && o.type == type && o.id == id;
  @override
  int get hashCode => Object.hash(type, id);
  @override
  String toString() => 'LienCible($type, $id)';
}

/// Liens inconnus ou sans équivalent mobile (/devoirs, /absences…) : on ouvre la liste des notifications,
/// où le texte complet reste lisible. Jamais d'adresse externe.
LienCible parseLien(String? lien) {
  final l = (lien ?? '').trim();
  if (!l.startsWith('/') || l.startsWith('//')) {
    return const LienCible(LienType.notifications);
  }
  final path = l.split('?').first.split('#').first;
  final m = RegExp(r'^/messagerie/(\d{1,9})/?$').firstMatch(path);
  if (m != null) return LienCible(LienType.message, int.parse(m.group(1)!));
  if (RegExp(r'^/messagerie/?$').hasMatch(path)) {
    return const LienCible(LienType.messagerie);
  }
  if (RegExp(r'^/annonces/?$').hasMatch(path)) {
    return const LienCible(LienType.annonces);
  }
  return const LienCible(LienType.notifications);
}

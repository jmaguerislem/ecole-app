/// Conversions sûres des réponses JSON (jamais d'exception de type à l'exécution).
List<Map<String, dynamic>> asList(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : <Map<String, dynamic>>[];
Map<String, dynamic> asMap(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
String str(dynamic v) => v == null ? '' : '$v';

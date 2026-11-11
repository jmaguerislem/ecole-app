import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'env.dart';

/// Erreur renvoyée par l'API (ou réseau). `message` est toujours lisible par l'utilisateur.
class ApiException implements Exception {
  final int status;
  final String message;
  final Map<String, dynamic> data;
  ApiException(this.status, this.message, [this.data = const {}]);

  /// Conflit d'emploi du temps (salle / enseignant / classe) : le détail est dans [conflits].
  bool get isEdtConflict => status == 409 && data['code'] == 'conflit_edt';
  List<Map<String, dynamic>> get conflits => _list(data['conflits']);
  List<Map<String, dynamic>> get sallesLibres =>
      _list((data['suggestions'] is Map)
          ? (data['suggestions'] as Map)['salles']
          : null);
  List<Map<String, dynamic>> get creneauxLibres =>
      _list((data['suggestions'] is Map)
          ? (data['suggestions'] as Map)['creneaux']
          : null);
  bool get needsConfirmation => status == 409 && data['confirmable'] == true;

  static List<Map<String, dynamic>> _list(dynamic v) => v is List
      ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];

  @override
  String toString() => message;
}

/// Client HTTP unique : ajoute le jeton JWT, décode le JSON, traduit les erreurs.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  final http.Client _client = http.Client();
  String? token;

  /// Appelé quand le serveur répond 401 alors qu'un jeton était envoyé (session expirée).
  void Function()? onUnauthorized;

  Uri _uri(String path, Map<String, dynamic>? query) {
    final params = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) params[k] = '$v';
    });
    final base = Env.apiUrl.endsWith('/')
        ? Env.apiUrl.substring(0, Env.apiUrl.length - 1)
        : Env.apiUrl;
    return Uri.parse('$base/api$path')
        .replace(queryParameters: params.isEmpty ? null : params);
  }

  Future<dynamic> _send(String method, String path,
      {Map<String, dynamic>? query, Object? body}) async {
    final headers = <String, String>{'Accept': 'application/json'};
    final sentToken = token;
    if (sentToken != null) headers['Authorization'] = 'Bearer $sentToken';
    if (body != null) headers['Content-Type'] = 'application/json';
    final uri = _uri(path, query);
    try {
      late http.Response res;
      final payload = body == null ? null : jsonEncode(body);
      const delai = Duration(seconds: 25);
      switch (method) {
        case 'POST':
          res = await _client
              .post(uri, headers: headers, body: payload)
              .timeout(delai);
          break;
        case 'PUT':
          res = await _client
              .put(uri, headers: headers, body: payload)
              .timeout(delai);
          break;
        case 'DELETE':
          res = await _client.delete(uri, headers: headers).timeout(delai);
          break;
        default:
          res = await _client.get(uri, headers: headers).timeout(delai);
      }
      dynamic data;
      if (res.body.isNotEmpty &&
          (res.headers['content-type'] ?? '').contains('json')) {
        data = jsonDecode(utf8.decode(res.bodyBytes));
      }
      if (res.statusCode >= 200 && res.statusCode < 300) return data;
      final map =
          data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      if (res.statusCode == 401 &&
          sentToken != null &&
          !path.startsWith('/auth/login')) {
        onUnauthorized?.call();
      }
      throw ApiException(res.statusCode,
          (map['error'] ?? 'Erreur ${res.statusCode}').toString(), map);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(0,
          'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.');
    } on SocketException {
      throw ApiException(0,
          'Impossible de joindre le serveur (${Env.apiUrl}). Vérifiez votre connexion.');
    } on http.ClientException {
      throw ApiException(0,
          'Impossible de joindre le serveur (${Env.apiUrl}). Vérifiez votre connexion.');
    } on FormatException {
      throw ApiException(0, 'Réponse inattendue du serveur.');
    }
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _send('GET', path, query: query);
  Future<dynamic> post(String path,
          {Object? body, Map<String, dynamic>? query}) =>
      _send('POST', path, body: body ?? <String, dynamic>{}, query: query);
  Future<dynamic> put(String path, {Object? body}) =>
      _send('PUT', path, body: body ?? <String, dynamic>{});
  Future<dynamic> delete(String path, {Map<String, dynamic>? query}) =>
      _send('DELETE', path, query: query);

  /// Raccourcis typés.
  Future<List<Map<String, dynamic>>> getList(String path,
      {Map<String, dynamic>? query}) async {
    final d = await get(path, query: query);
    return d is List
        ? d.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> getMap(String path,
      {Map<String, dynamic>? query}) async {
    final d = await get(path, query: query);
    return d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
  }
}

final api = ApiClient.instance;

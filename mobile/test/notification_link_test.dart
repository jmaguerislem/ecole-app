import 'package:ecole_mobile/core/notification_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('messages : /messagerie/<id> ouvre la conversation', () {
    expect(parseLien('/messagerie/12'), const LienCible(LienType.message, 12));
    expect(parseLien('/messagerie/12/'), const LienCible(LienType.message, 12));
    expect(parseLien('/messagerie/7?x=1#a'), const LienCible(LienType.message, 7));
  });
  test('boîte de messagerie et annonces', () {
    expect(parseLien('/messagerie'), const LienCible(LienType.messagerie));
    expect(parseLien('/annonces'), const LienCible(LienType.annonces));
  });
  test('pages sans équivalent mobile → liste des notifications', () {
    for (final l in ['/devoirs', '/absences', '/retards', '/reclamations', '/preinscriptions', '/emploi-du-temps']) {
      expect(parseLien(l), const LienCible(LienType.notifications), reason: l);
    }
  });
  test('liens vides, externes ou piégés → liste des notifications', () {
    for (final l in [null, '', 'https://evil.test/x', '//evil.test', 'javascript:alert(1)', '/messagerie/abc', '/messagerie/1234567890123']) {
      expect(parseLien(l), const LienCible(LienType.notifications), reason: '$l');
    }
  });
}

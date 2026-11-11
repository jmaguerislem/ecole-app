import 'package:ecole_mobile/core/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('montants en dinars tunisiens', () {
    expect(nombre(1234.5), '1\u202F234,50');
    expect(money(1000), '1\u202F000,00 TND');
    expect(moneyShort(800), '800 TND');
    expect(money(null), '0,00 TND');
  });

  test('dates françaises', () {
    expect(dateFr('2026-11-09'), '09/11/2026');
    expect(dateFr(null), '—');
    expect(moisAnnee('2026-03-01'), 'Mars 2026');
    expect(hm('08:00:00'), '08:00');
  });

  test('pluriel', () {
    expect(pluriel(1, 'devoir'), '1 devoir');
    expect(pluriel(3, 'devoir'), '3 devoirs');
  });
}

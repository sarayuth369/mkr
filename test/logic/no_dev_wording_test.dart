import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regression guard: none of the translated strings shipped to users may
/// leak internal development-stage language. Scans both ARB source files
/// directly so it catches a regression regardless of which screen uses the
/// key.
void main() {
  const forbidden = ['phase 1', 'mock purchase'];

  for (final path in ['lib/l10n/app_en.arb', 'lib/l10n/app_th.arb']) {
    test('$path contains no internal development wording', () {
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: '$path should exist');

      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      for (final entry in json.entries) {
        if (entry.key.startsWith('@')) continue;
        final value = entry.value;
        if (value is! String) continue;
        final lower = value.toLowerCase();
        for (final phrase in forbidden) {
          expect(
            lower.contains(phrase),
            isFalse,
            reason: 'ARB key "${entry.key}" contains forbidden wording "$phrase": "$value"',
          );
        }
      }
    });
  }
}

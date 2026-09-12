import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/impact_badge.dart';
import 'package:mkr/domain/impact_level.dart';

void main() {
  testWidgets('renders the correct label for each impact level', (tester) async {
    for (final level in ImpactLevel.values) {
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: ImpactBadge(impact: level))),
      );
      expect(find.text(level.label), findsOneWidget);
    }
  });
}

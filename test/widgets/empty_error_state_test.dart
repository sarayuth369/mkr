import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/empty_state.dart';
import 'package:mkr/core/widgets/error_state.dart';

void main() {
  testWidgets('EmptyState shows message and optional action', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EmptyState(
            message: 'Nothing here',
            actionLabel: 'Add',
            onAction: () => tapped = true,
          ),
        ),
      ),
    );

    expect(find.text('Nothing here'), findsOneWidget);
    await tester.tap(find.text('Add'));
    expect(tapped, isTrue);
  });

  testWidgets('ErrorState shows message and calls retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ErrorState(message: 'Failed to load', onRetry: () => retried = true),
        ),
      ),
    );

    expect(find.text('Failed to load'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });
}

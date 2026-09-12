import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/core/widgets/empty_state.dart';
import 'package:mkr/core/widgets/error_state.dart';
import 'package:mkr/l10n/generated/app_localizations.dart';

Widget _localizedApp(Widget child) {
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: child),
  );
}

void main() {
  testWidgets('EmptyState shows message and optional action', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      _localizedApp(
        EmptyState(
          message: 'Nothing here',
          actionLabel: 'Add',
          onAction: () => tapped = true,
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
      _localizedApp(
        ErrorState(message: 'Failed to load', onRetry: () => retried = true),
      ),
    );

    expect(find.text('Failed to load'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:mkr/features/ai/domain/ai_insight.dart';
import 'package:mkr/features/ai/domain/market_ai_service.dart';
import 'package:mkr/features/ai_ask/application/ai_ask_controller.dart';
import 'package:mkr/features/ai_ask/presentation/screens/ai_ask_screen.dart';
import 'package:mkr/l10n/generated/app_localizations.dart';

class _FakeAiService implements MarketAIService {
  @override
  Future<String> ask(String question) async => 'Gold is holding firm near recent highs.';

  @override
  Future<AIInsight> getDailyBrief() => throw UnimplementedError();

  @override
  Future<AIInsight> getAssetInsight(String symbol) => throw UnimplementedError();

  @override
  Future<AIInsight> summarizeNews(dynamic article) => throw UnimplementedError();

  @override
  Future<AIInsight> analyzeMarketImpact(dynamic event) => throw UnimplementedError();
}

/// 2026-09-17 Final UX/Reliability task regression coverage: a real
/// network/provider failure used to render as the raw exception text
/// inside an otherwise-normal assistant bubble.
class _FailingAiService implements MarketAIService {
  @override
  Future<String> ask(String question) async => throw Exception('SocketException: Failed host lookup');

  @override
  Future<AIInsight> getDailyBrief() => throw UnimplementedError();

  @override
  Future<AIInsight> getAssetInsight(String symbol) => throw UnimplementedError();

  @override
  Future<AIInsight> summarizeNews(dynamic article) => throw UnimplementedError();

  @override
  Future<AIInsight> analyzeMarketImpact(dynamic event) => throw UnimplementedError();
}

void main() {
  testWidgets('tapping a suggested prompt sends a user message and shows the AI reply', (tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AiAskController(_FakeAiService())),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const AiAskScreen(),
        ),
      ),
    );

    await tester.tap(find.text('Gold outlook'));
    await tester.pump();
    expect(find.text('Gold outlook'), findsWidgets);

    await tester.pumpAndSettle();
    expect(find.text('Gold is holding firm near recent highs.'), findsOneWidget);
  });

  testWidgets('a failed AI call shows a friendly localized message, never the raw exception text', (tester) async {
    final controller = AiAskController(_FailingAiService());
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: controller)],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const AiAskScreen(),
        ),
      ),
    );

    await controller.send('What is gold?');
    await tester.pumpAndSettle();

    expect(find.textContaining('SocketException'), findsNothing);
    expect(find.textContaining('Exception'), findsNothing);
    final l10n = AppLocalizations.of(tester.element(find.byType(AiAskScreen)));
    expect(find.text(l10n.aiAskError), findsOneWidget);
  });
}

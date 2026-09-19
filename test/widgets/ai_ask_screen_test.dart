import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mkr/core/persistence/app_local_store.dart';
import 'package:mkr/features/ai/domain/ai_insight.dart';
import 'package:mkr/features/ai/domain/market_ai_service.dart';
import 'package:mkr/features/ai_ask/application/ai_ask_controller.dart';
import 'package:mkr/features/ai_ask/presentation/screens/ai_ask_screen.dart';
import 'package:mkr/features/billing/application/entitlement_controller.dart';
import 'package:mkr/features/billing/data/mock_billing_repository.dart';
import 'package:mkr/features/billing/domain/entitlement.dart';
import 'package:mkr/l10n/generated/app_localizations.dart';

class _FakeAiService implements MarketAIService {
  int askCallCount = 0;

  @override
  Future<String> ask(String question) async {
    askCallCount++;
    return 'Gold is holding firm near recent highs.';
  }

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

/// 2026-09-19 Monetization Release 3 fix - AI Ask now requires the AI Pro
/// entitlement (see ai_ask_controller.dart's own doc comment), so every
/// test needs a real [EntitlementController] reporting the tier under
/// test, not just a bare AI service.
Future<EntitlementController> _entitlementController({required PremiumTier tier}) async {
  SharedPreferences.setMockInitialValues({});
  final store = await AppLocalStore.create();
  if (tier != PremiumTier.free) await store.setEntitlementTier(tier.name);
  final controller = EntitlementController(MockBillingRepository(store));
  // EntitlementController's constructor kicks off an async _load() - give
  // it a microtask tick to resolve the seeded tier before tests read it.
  // A real Timer-based `Future.delayed` never fires here: testWidgets runs
  // inside a fake-async zone where real timers only advance via
  // tester.pump(), so using one would hang this helper forever.
  await Future<void>.microtask(() {});
  return controller;
}

void main() {
  testWidgets('AI Pro: tapping a suggested prompt sends a user message and shows the AI reply', (tester) async {
    final entitlement = await _entitlementController(tier: PremiumTier.aiPro);
    final aiService = _FakeAiService();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AiAskController(aiService, entitlement)),
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
    expect(aiService.askCallCount, 1);
  });

  testWidgets('AI Pro: a failed AI call shows a friendly localized message, never the raw exception text', (tester) async {
    final entitlement = await _entitlementController(tier: PremiumTier.aiPro);
    final controller = AiAskController(_FailingAiService(), entitlement);
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

  testWidgets('Free tier: shows the paywall gate, hides the input, and send() never calls the AI service', (tester) async {
    final entitlement = await _entitlementController(tier: PremiumTier.free);
    final aiService = _FakeAiService();
    final controller = AiAskController(aiService, entitlement);
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
    await tester.pumpAndSettle();

    expect(controller.isLocked, isTrue);
    // The chat input/suggested prompts are not even reachable while locked.
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Gold outlook'), findsNothing);
    // A clear upgrade path is shown instead.
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);

    // Defense-in-depth (application/domain boundary, not just the hidden
    // UI): even a direct call to send() must be a no-op while locked - no
    // alternate call path can reach a real AI request.
    await controller.send('What is gold?');
    expect(aiService.askCallCount, 0);
    expect(controller.messages, isEmpty);
  });

  testWidgets('Pro tier (not AI Pro): still locked out of AI Ask per the documented AI-Pro-exclusive design', (tester) async {
    final entitlement = await _entitlementController(tier: PremiumTier.pro);
    final aiService = _FakeAiService();
    final controller = AiAskController(aiService, entitlement);

    expect(controller.isLocked, isTrue);
    await controller.send('What is gold?');
    expect(aiService.askCallCount, 0);
  });

  testWidgets('Lifetime tier: still locked out of AI Ask - Lifetime intentionally excludes unlimited AI', (tester) async {
    final entitlement = await _entitlementController(tier: PremiumTier.lifetime);
    final aiService = _FakeAiService();
    final controller = AiAskController(aiService, entitlement);

    expect(controller.isLocked, isTrue);
    await controller.send('What is gold?');
    expect(aiService.askCallCount, 0);
  });
}

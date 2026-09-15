import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import '../core/config/supabase_config.dart';
import '../core/localization/locale_controller.dart';
import '../core/persistence/app_local_store.dart';
import '../core/theme/app_theme.dart';
import '../core/theme/theme_controller.dart';
import '../features/ads/application/app_open_ad_manager.dart';
import '../features/ads/data/mock_ad_service.dart';
import '../features/ads/domain/ad_analytics.dart';
import '../features/ads/domain/ad_config.dart';
import '../features/ads/domain/ad_service.dart';
import '../features/ads/presentation/widgets/app_open_ad_host.dart';
import '../features/ai/data/cloudflare_market_ai_service.dart';
import '../features/ai/data/mock_market_ai_service.dart';
import '../features/ai/domain/market_ai_service.dart';
import '../features/ai_ask/application/ai_ask_controller.dart';
import '../features/alerts/application/alerts_controller.dart';
import '../features/alerts/data/mock_alert_repository.dart';
import '../features/alerts/data/mock_notification_service.dart';
import '../features/alerts/data/supabase_alert_cloud_sync.dart';
import '../features/alerts/data/supabase_alert_repository.dart';
import '../features/alerts/domain/alert_cloud_sync.dart';
import '../features/alerts/domain/alert_repository.dart';
import '../features/alerts/domain/notification_service.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/data/mock_auth_service.dart';
import '../features/auth/data/supabase_auth_service.dart';
import '../features/auth/domain/auth_service.dart';
import '../features/billing/application/entitlement_controller.dart';
import '../features/billing/data/mock_billing_repository.dart';
import '../features/billing/domain/billing_repository.dart';
import '../features/calendar/application/calendar_controller.dart';
import '../features/calendar/data/mkr_economic_calendar_service.dart';
import '../features/calendar/data/mock_economic_calendar_service.dart';
import '../features/calendar/domain/economic_calendar_service.dart';
import '../features/gold/application/gold_radar_controller.dart';
import '../features/home/application/home_controller.dart';
import '../features/markets/application/markets_controller.dart';
import '../features/markets/data/market_catalog_repository.dart';
import '../features/markets/data/market_data_config.dart';
import '../features/markets/data/market_provider_manager.dart';
import '../features/markets/data/mock_market_service.dart';
import '../features/markets/data/provider_backed_market_service.dart';
import '../features/markets/data/providers/alpaca_provider.dart';
import '../features/markets/data/providers/twelve_data_provider.dart';
import '../features/markets/domain/market_service.dart';
import '../features/news/application/news_controller.dart';
import '../features/news/data/finnhub_news_service.dart';
import '../features/news/data/mock_news_service.dart';
import '../features/news/domain/news_service.dart';
import '../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../features/portfolio/application/portfolio_controller.dart';
import '../features/portfolio/data/mock_portfolio_repository.dart';
import '../features/portfolio/domain/portfolio_repository.dart';
import '../features/push/data/firebase_push_notification_service.dart';
import '../features/push/data/noop_push_notification_service.dart';
import '../features/push/data/supabase_device_repository.dart';
import '../features/push/data/supabase_notification_history_service.dart';
import '../features/push/domain/device_repository.dart';
import '../features/push/domain/notification_history.dart';
import '../features/push/domain/push_notification_service.dart';
import '../features/watchlist/application/watchlist_controller.dart';
import '../features/watchlist/data/mock_watchlist_repository.dart';
import '../features/watchlist/data/supabase_watchlist_repository.dart';
import '../features/watchlist/domain/watchlist_repository.dart';
import '../l10n/generated/app_localizations.dart';
import 'app_shell.dart';

/// Picks the real [ProviderBackedMarketService] (Twelve Data primary,
/// Alpaca standby, proxied through the deployed MKR Cloudflare Worker) —
/// the default since `MarketDataConfig`'s real mode is now the default.
/// Falls back to [MockMarketService] only when explicitly built with
/// `--dart-define=MARKET_DATA_MODE=demo`.
MarketService _buildMarketService() {
  final config = MarketDataConfig.fromEnvironment();
  if (config.mode == MarketDataRunMode.demo) return MockMarketService();

  final manager = MarketProviderManager(
    primary: TwelveDataProvider(backendBaseUrl: config.backendBaseUrl),
    secondary: AlpacaProvider(backendBaseUrl: config.backendBaseUrl, activated: config.secondaryEnabled),
    secondaryEnabled: config.secondaryEnabled,
  );
  unawaited(manager.connect());
  // 2026-09-15 hardening task: real mode now sources its symbol list from
  // the backend's own catalog (`GET /api/mkr/market/symbols`), never
  // MockMarketCatalog - see MarketCatalogRepository's doc comment.
  final catalog = MarketCatalogRepository(backendBaseUrl: config.backendBaseUrl);
  return ProviderBackedMarketService(manager, catalog);
}

/// Real [CloudflareMarketAIService] (Cloudflare Workers AI, proxied through
/// the same deployed MKR Worker as market data) whenever real mode is on —
/// otherwise [MockMarketAIService]. Reuses [MarketDataConfig]'s real/demo
/// signal and backend URL rather than a separate dart-define: it is the
/// same backend deployment either way, and the AI routes are gated
/// independently server-side by the `aiBriefEnabled` feature flag (off
/// until an admin verifies it in Admin Web → Feature Flags), so a real-mode
/// build with the flag still off simply surfaces a clear "not enabled"
/// error through the existing AI Ask/Brief error-state UI, never a crash.
MarketAIService _buildMarketAIService() {
  final config = MarketDataConfig.fromEnvironment();
  if (config.mode == MarketDataRunMode.demo) return MockMarketAIService();
  return CloudflareMarketAIService(backendBaseUrl: config.backendBaseUrl);
}

/// Real Firebase-backed push only once `main.dart`'s `_initializeFirebase()`
/// actually succeeded (i.e. `Firebase.apps` is non-empty — mirrors exactly
/// how `SupabaseConfig.instance.isConfigured` branches Supabase-backed
/// providers below). Falls back to the existing Noop implementation
/// otherwise, so an install without a Firebase project keeps behaving
/// exactly as it did before this task.
PushNotificationService _buildPushNotificationService() {
  return Firebase.apps.isNotEmpty ? FirebaseMessagingPushService() : const NoopPushNotificationService();
}

/// Real [FinnhubNewsService]/[MkrEconomicCalendarService] whenever real
/// mode is on - reusing [MarketDataConfig]'s real/demo signal and backend
/// URL, same reasoning as [_buildMarketAIService]: one backend deployment,
/// each surface independently gated server-side by its own feature flag
/// (newsEnabled/economicCalendarEnabled), off until an admin verifies it.
NewsService _buildNewsService() {
  final config = MarketDataConfig.fromEnvironment();
  if (config.mode == MarketDataRunMode.demo) return MockNewsService();
  return FinnhubNewsService(backendBaseUrl: config.backendBaseUrl);
}

EconomicCalendarService _buildEconomicCalendarService() {
  final config = MarketDataConfig.fromEnvironment();
  if (config.mode == MarketDataRunMode.demo) return MockEconomicCalendarService();
  return MkrEconomicCalendarService(backendBaseUrl: config.backendBaseUrl);
}

class MkrApp extends StatelessWidget {
  const MkrApp({super.key, required this.store, MarketService? marketService}) : _marketServiceOverride = marketService;

  final AppLocalStore store;

  /// Test-only seam (2026-09-15 hardening task): widget tests construct
  /// [MkrApp] directly with no way to control `MarketDataConfig`'s
  /// environment-derived real/demo mode, so a widget/navigation smoke test
  /// would otherwise always exercise the REAL network path (previously
  /// masked by [ProviderBackedMarketService] silently using the static
  /// [MockMarketCatalog] even in "real" mode - the exact bug this task
  /// fixes). Passing an explicit [MarketService] here (e.g.
  /// [MockMarketService]) makes such tests deterministic without any
  /// network dependency; production `main.dart` never passes this.
  final MarketService? _marketServiceOverride;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AppLocalStore>.value(value: store),
        ChangeNotifierProvider(create: (_) => ThemeController(store)),
        ChangeNotifierProvider(create: (_) => LocaleController(store)),

        // Backend-abstraction seams — swap Mock* for real implementations
        // behind these same interfaces in Phase 2.
        Provider<MarketService>(create: (_) => _marketServiceOverride ?? _buildMarketService()),
        Provider<MarketAIService>(create: (_) => _buildMarketAIService()),
        Provider<NewsService>(create: (_) => _buildNewsService()),
        Provider<EconomicCalendarService>(create: (_) => _buildEconomicCalendarService()),
        Provider<NotificationService>(create: (_) => MockNotificationService()),
        Provider<PortfolioRepository>(create: (_) => MockPortfolioRepository(store)),
        Provider<BillingRepository>(create: (_) => MockBillingRepository(store)),
        Provider<AdAnalytics>(create: (_) => const NoopAdAnalytics()),
        Provider<AdConfig>(create: (_) => AdConfig.fromEnvironment()),
        Provider<AdService>(create: (ctx) => MockAdService(analytics: ctx.read<AdAnalytics>())),
        Provider<PushNotificationService>(create: (_) => _buildPushNotificationService()),

        // User-data seam (Phase 2.2): Supabase-backed when configured (see
        // SupabaseConfig/main.dart), MockAuthService/MockWatchlistRepository
        // otherwise — the app never depends on Supabase being provisioned.
        Provider<AuthService>(create: (_) => SupabaseConfig.instance.isConfigured ? SupabaseAuthService(store) : MockAuthService(store)),
        ChangeNotifierProvider(
          create: (ctx) => AuthController(
            ctx.read<AuthService>(),
            pushService: ctx.read<PushNotificationService>(),
            deviceRepository: SupabaseConfig.instance.isConfigured ? const SupabaseDeviceRepository() : const NoopDeviceRepository(),
          ),
        ),
        Provider<WatchlistRepository>(
          create: (ctx) => SupabaseConfig.instance.isConfigured
              ? SupabaseWatchlistRepository(store, ctx.read<AuthController>())
              : MockWatchlistRepository(store),
        ),
        Provider<NotificationHistoryService>(
          create: (ctx) => SupabaseConfig.instance.isConfigured
              ? SupabaseNotificationHistoryService(ctx.read<AuthController>())
              : const NoopNotificationHistoryService(),
        ),
        Provider<AlertRepository>(
          create: (ctx) => SupabaseConfig.instance.isConfigured
              ? SupabaseAlertRepository(store, ctx.read<AuthController>())
              : MockAlertRepository(store),
        ),

        ChangeNotifierProvider(create: (ctx) => EntitlementController(ctx.read<BillingRepository>())),
        ChangeNotifierProvider(create: (ctx) => WatchlistController(ctx.read<WatchlistRepository>(), ctx.read<MarketService>())),
        ChangeNotifierProvider(
          create: (ctx) => AlertsController(
            repository: ctx.read<AlertRepository>(),
            notificationService: ctx.read<NotificationService>(),
            calendarService: ctx.read<EconomicCalendarService>(),
            cloudSync: SupabaseConfig.instance.isConfigured ? SupabaseAlertCloudSync(ctx.read<AuthController>()) : const NoopAlertCloudSync(),
          ),
        ),
        ChangeNotifierProvider(create: (ctx) => PortfolioController(ctx.read<PortfolioRepository>())),
        ChangeNotifierProvider(create: (ctx) => NewsController(ctx.read<NewsService>())),
        ChangeNotifierProvider(create: (ctx) => CalendarController(ctx.read<EconomicCalendarService>())),
        ChangeNotifierProvider(
          create: (ctx) => MarketsController(ctx.read<MarketService>()),
        ),
        ChangeNotifierProvider(
          create: (ctx) => HomeController(
            marketService: ctx.read<MarketService>(),
            aiService: ctx.read<MarketAIService>(),
            calendarService: ctx.read<EconomicCalendarService>(),
          ),
        ),
        ChangeNotifierProvider(
          create: (ctx) => GoldRadarController(
            marketService: ctx.read<MarketService>(),
            aiService: ctx.read<MarketAIService>(),
            calendarService: ctx.read<EconomicCalendarService>(),
          ),
        ),
        ChangeNotifierProvider(create: (ctx) => AiAskController(ctx.read<MarketAIService>())),
        Provider<AppOpenAdManager>(
          create: (ctx) => AppOpenAdManager(adService: ctx.read<AdService>(), config: ctx.read<AdConfig>()),
        ),
      ],
      child: const _AppView(),
    );
  }
}

class _AppView extends StatefulWidget {
  const _AppView();

  @override
  State<_AppView> createState() => _AppViewState();
}

class _AppViewState extends State<_AppView> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Pause the demo market simulation while backgrounded so it doesn't
    // keep ticking (and draining battery) for a screen nobody can see;
    // resume the moment the app is visible again. No-op for a real
    // push-based backend that doesn't poll.
    final marketService = context.read<MarketService>();
    switch (state) {
      case AppLifecycleState.resumed:
        marketService.resume();
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
        marketService.pause();
    }
  }

  @override
  Widget build(BuildContext context) {
    final themeController = context.watch<ThemeController>();
    final localeController = context.watch<LocaleController>();
    final store = context.read<AppLocalStore>();

    return MaterialApp(
      title: 'MKR',
      debugShowCheckedModeBanner: false,
      themeMode: themeController.mode,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      locale: localeController.locale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Several cards/sections below assume a bounded height for compact
      // number/label rows (MarketCard's Market Pulse row, GlobalMarketsBanner's
      // headline/subtitle pair, etc). An unclamped system font-size setting
      // (very common on Android - many OEMs default above 1.0, and
      // accessibility settings can go well past 2.0) can push those rows
      // taller than their fixed height, overflowing by a few pixels. Clamping
      // to a reasonable max keeps every fixed-height row safe app-wide while
      // still honoring most of the user's accessibility preference (unlike
      // ignoring text scaling entirely, which a max of 1.0 would do).
      builder: (context, child) {
        final mediaQuery = MediaQuery.of(context);
        return MediaQuery(
          data: mediaQuery.copyWith(textScaler: mediaQuery.textScaler.clamp(maxScaleFactor: 1.3)),
          child: child!,
        );
      },
      home: store.isOnboardingComplete
          ? const AppOpenAdHost(child: AppShell())
          : _OnboardingGate(store: store),
    );
  }
}

class _OnboardingGate extends StatefulWidget {
  const _OnboardingGate({required this.store});

  final AppLocalStore store;

  @override
  State<_OnboardingGate> createState() => _OnboardingGateState();
}

class _OnboardingGateState extends State<_OnboardingGate> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    if (_done) return const AppOpenAdHost(child: AppShell());
    return OnboardingScreen(
      onDone: () async {
        await widget.store.setOnboardingComplete(true);
        setState(() => _done = true);
      },
    );
  }
}

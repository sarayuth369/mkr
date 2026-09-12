import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import '../core/localization/locale_controller.dart';
import '../core/persistence/app_local_store.dart';
import '../core/theme/app_theme.dart';
import '../core/theme/theme_controller.dart';
import '../features/ads/data/mock_ad_service.dart';
import '../features/ads/domain/ad_service.dart';
import '../features/ai/data/mock_market_ai_service.dart';
import '../features/ai/domain/market_ai_service.dart';
import '../features/alerts/application/alerts_controller.dart';
import '../features/alerts/data/mock_alert_repository.dart';
import '../features/alerts/data/mock_notification_service.dart';
import '../features/alerts/domain/alert_repository.dart';
import '../features/alerts/domain/notification_service.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/data/mock_auth_service.dart';
import '../features/auth/domain/auth_service.dart';
import '../features/billing/application/entitlement_controller.dart';
import '../features/billing/data/mock_billing_repository.dart';
import '../features/billing/domain/billing_repository.dart';
import '../features/calendar/application/calendar_controller.dart';
import '../features/calendar/data/mock_economic_calendar_service.dart';
import '../features/calendar/domain/economic_calendar_service.dart';
import '../features/gold/application/gold_radar_controller.dart';
import '../features/home/application/home_controller.dart';
import '../features/markets/application/markets_controller.dart';
import '../features/markets/data/mock_market_service.dart';
import '../features/markets/domain/market_service.dart';
import '../features/news/application/news_controller.dart';
import '../features/news/data/mock_news_service.dart';
import '../features/news/domain/news_service.dart';
import '../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../features/portfolio/application/portfolio_controller.dart';
import '../features/portfolio/data/mock_portfolio_repository.dart';
import '../features/portfolio/domain/portfolio_repository.dart';
import '../features/watchlist/application/watchlist_controller.dart';
import '../features/watchlist/data/mock_watchlist_repository.dart';
import '../features/watchlist/domain/watchlist_repository.dart';
import '../l10n/generated/app_localizations.dart';
import 'app_shell.dart';

class MkrApp extends StatelessWidget {
  const MkrApp({super.key, required this.store});

  final AppLocalStore store;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AppLocalStore>.value(value: store),
        ChangeNotifierProvider(create: (_) => ThemeController(store)),
        ChangeNotifierProvider(create: (_) => LocaleController(store)),

        // Backend-abstraction seams — swap Mock* for real implementations
        // behind these same interfaces in Phase 2.
        Provider<MarketService>(create: (_) => MockMarketService()),
        Provider<MarketAIService>(create: (_) => MockMarketAIService()),
        Provider<NewsService>(create: (_) => MockNewsService()),
        Provider<EconomicCalendarService>(create: (_) => MockEconomicCalendarService()),
        Provider<WatchlistRepository>(create: (_) => MockWatchlistRepository(store)),
        Provider<AlertRepository>(create: (_) => MockAlertRepository(store)),
        Provider<NotificationService>(create: (_) => MockNotificationService()),
        Provider<PortfolioRepository>(create: (_) => MockPortfolioRepository(store)),
        Provider<BillingRepository>(create: (_) => MockBillingRepository(store)),
        Provider<AdService>(create: (_) => MockAdService()),
        Provider<AuthService>(create: (_) => MockAuthService(store)),

        ChangeNotifierProvider(create: (ctx) => AuthController(ctx.read<AuthService>())),
        ChangeNotifierProvider(create: (ctx) => EntitlementController(ctx.read<BillingRepository>())),
        ChangeNotifierProvider(create: (ctx) => WatchlistController(ctx.read<WatchlistRepository>())),
        ChangeNotifierProvider(
          create: (ctx) => AlertsController(
            repository: ctx.read<AlertRepository>(),
            notificationService: ctx.read<NotificationService>(),
            calendarService: ctx.read<EconomicCalendarService>(),
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
      ],
      child: const _AppView(),
    );
  }
}

class _AppView extends StatelessWidget {
  const _AppView();

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
      home: store.isOnboardingComplete
          ? const AppShell()
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
    if (_done) return const AppShell();
    return OnboardingScreen(
      onDone: () async {
        await widget.store.setOnboardingComplete(true);
        setState(() => _done = true);
      },
    );
  }
}

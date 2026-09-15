import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/network/api_state.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ai_insight_card.dart';
import '../../../../core/widgets/app_logo_mark.dart';
import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/global_markets_banner.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_card.dart';
import '../../../../core/widgets/market_data_status_chip.dart';
import '../../../../core/widgets/price_chart.dart';
import '../../../../core/widgets/radar_card.dart';
import '../../../../domain/market_data_mode.dart';
import '../../../../domain/market_quote.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/mkr_ad_slot.dart';
import '../../../ai_ask/presentation/screens/ai_ask_screen.dart';
import '../../../gold/presentation/screens/gold_radar_screen.dart';
import '../../../markets/domain/market_service.dart';
import '../../../markets/presentation/screens/market_detail_screen.dart';
import '../../../news/presentation/screens/news_screen.dart';
import '../../../calendar/presentation/screens/calendar_screen.dart';
import '../../application/home_controller.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<HomeController>();

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 64,
        title: Row(
          children: [
            const AppLogoMark(size: 36),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.homeHeaderTitle, style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                  Text(
                    l10n.homeHeaderSubtitle,
                    style: Theme.of(context).textTheme.labelSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.auto_awesome_outlined),
            tooltip: l10n.aiAskTitle,
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AiAskScreen())),
          ),
          IconButton(
            icon: const Icon(Icons.article_outlined),
            tooltip: l10n.newsTitle,
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NewsScreen())),
          ),
          IconButton(
            icon: const Icon(Icons.event_note_outlined),
            tooltip: l10n.calendarTitle,
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CalendarScreen())),
          ),
        ],
      ),
      body: MkrAdBody(
        child: RefreshIndicator(
        onRefresh: controller.refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            MarketDataStatusChip(mode: controller.mode.effectiveFor(controller.pulseState), lastUpdated: controller.lastUpdated),
            const SizedBox(height: 14),
            _GlobalMarketsSection(controller: controller),
            const SizedBox(height: 20),
            Text(l10n.homeMarketPulse, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            _PulseSection(controller: controller),
            const SizedBox(height: 24),
            Text(l10n.homeTodaysRadar, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            _RadarSection(controller: controller),
            const SizedBox(height: 24),
            _AiBriefSection(controller: controller),
            const SizedBox(height: 24),
            _SectionHeader(
              title: l10n.homeGoldRadar,
              seeAllLabel: l10n.seeAll,
              onSeeAll: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GoldRadarScreen())),
            ),
            const SizedBox(height: 8),
            if (controller.gold != null)
              MarketCard(
                quote: controller.gold!,
                label: 'XAU/USD',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MarketDetailScreen(symbol: 'XAU/USD')),
                ),
              ),
            const SizedBox(height: 24),
            Text(l10n.homeMarketSnapshot, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            _SnapshotList(controller: controller),
          ],
        ),
        ),
      ),
      bottomNavigationBar: const MkrBottomBannerAd(),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.seeAllLabel, required this.onSeeAll});

  final String title;
  final String seeAllLabel;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        TextButton(onPressed: onSeeAll, child: Text(seeAllLabel)),
      ],
    );
  }
}

class _GlobalMarketsSection extends StatelessWidget {
  const _GlobalMarketsSection({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brief = controller.briefState.dataOrNull;
    final gold = controller.gold;
    MarketQuote? btc;
    for (final q in controller.pulseState.dataOrNull ?? const <MarketQuote>[]) {
      if (q.symbol == 'BTC') {
        btc = q;
        break;
      }
    }

    final pages = <GlobalMarketsPage>[
      if (brief != null) (headline: l10n.homeGlobalMarketsMixed, subtitle: brief.summary),
      if (gold != null)
        (
          headline: l10n.homeGlobalMarketsGold,
          subtitle: gold.isUp ? l10n.homeGlobalMarketsGoldUp : l10n.homeGlobalMarketsGoldDown,
        ),
      if (btc != null)
        (
          headline: l10n.homeGlobalMarketsCrypto,
          subtitle: btc.isUp ? l10n.homeGlobalMarketsCryptoUp : l10n.homeGlobalMarketsCryptoDown,
        ),
    ];

    if (pages.isEmpty) return const SizedBox.shrink();
    return GlobalMarketsBanner(title: l10n.homeGlobalMarkets, pages: pages);
  }
}

class _PulseSection extends StatefulWidget {
  const _PulseSection({required this.controller});

  final HomeController controller;

  @override
  State<_PulseSection> createState() => _PulseSectionState();
}

class _PulseSectionState extends State<_PulseSection> {
  String? _selectedSymbol;
  // Real changePct of the selected quote, for genuine trend direction -
  // never MockMarketCatalog (2026-09-15 correction task, Defect D).
  double _selectedChangePct = 0;
  List<double>? _series;
  ChartTimeframe _timeframe = ChartTimeframe.d1;
  bool _loadingSeries = false;

  Future<void> _selectSymbol(MarketQuote quote) async {
    setState(() {
      _selectedSymbol = quote.symbol;
      _selectedChangePct = quote.changePct;
      _loadingSeries = true;
    });
    final series = await context.read<MarketService>().getPriceSeries(quote.symbol, _timeframe);
    if (!mounted) return;
    setState(() {
      _series = series;
      _loadingSeries = false;
    });
  }

  Future<void> _changeTimeframe(ChartTimeframe timeframe) async {
    if (_selectedSymbol == null) return;
    setState(() {
      _timeframe = timeframe;
      _loadingSeries = true;
    });
    final series = await context.read<MarketService>().getPriceSeries(_selectedSymbol!, timeframe);
    if (!mounted) return;
    setState(() {
      _series = series;
      _loadingSeries = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          // Headroom above MarketCard(featured: true)'s natural content
          // height at 1.0x text scale (label + price + change row +
          // sparkline), so the app-wide text-scale clamp (see MaterialApp's
          // builder in app.dart) never pushes it past this fixed height.
          height: 144,
          child: widget.controller.pulseState.when(
            loading: () => ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: 3,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (_, __) => const LoadingSkeleton(width: 156, height: 136, borderRadius: 16),
            ),
            error: (message) => ErrorState(message: message, onRetry: widget.controller.refresh),
            empty: () => const SizedBox.shrink(),
            success: (quotes, isStale, lastUpdated) {
              if (_selectedSymbol == null && quotes.isNotEmpty) {
                WidgetsBinding.instance.addPostFrameCallback((_) => _selectSymbol(quotes.first));
              }
              return ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: quotes.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (context, index) {
                  final quote = quotes[index];
                  return Center(
                    child: MarketCard(
                      quote: quote,
                      featured: true,
                      onTap: () => _selectSymbol(quote),
                    ),
                  );
                },
              );
            },
          ),
        ),
        if (_selectedSymbol != null) ...[
          const SizedBox(height: 14),
          _loadingSeries || _series == null
              ? const LoadingSkeleton(height: 90, width: double.infinity, borderRadius: 12)
              : _series!.isEmpty
                  ? const SizedBox.shrink()
                  : PriceChart(
                      series: _series!,
                      isUp: _selectedChangePct >= 0,
                      height: 90,
                      onTimeframeChanged: _changeTimeframe,
                    ),
        ],
      ],
    );
  }
}

class _SnapshotList extends StatelessWidget {
  const _SnapshotList({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    final ApiState<List<MarketQuote>> state = controller.snapshotState;
    return state.when(
      loading: () => const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: LoadingSkeletonList(rows: 3, rowHeight: 48)),
      error: (message) => ErrorState(message: message, onRetry: controller.refresh),
      empty: () => const SizedBox.shrink(),
      success: (quotes, isStale, lastUpdated) => Column(
        children: [
          for (final quote in quotes)
            AssetRow(
              quote: quote,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => MarketDetailScreen(symbol: quote.symbol)),
              ),
            ),
        ],
      ),
    );
  }
}

class _RadarSection extends StatelessWidget {
  const _RadarSection({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return controller.radarState.when(
      loading: () => const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: LoadingSkeletonList(rows: 2, rowHeight: 40)),
      error: (message) => ErrorState(message: message, onRetry: controller.refresh),
      empty: () => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(l10n.homeNothingScheduled),
      ),
      success: (items, isStale, lastUpdated) => Column(
        children: [for (final item in items) RadarCard(item: item)],
      ),
    );
  }
}

class _AiBriefSection extends StatelessWidget {
  const _AiBriefSection({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return controller.briefState.when(
      loading: () => const LoadingSkeleton(height: 200, width: double.infinity, borderRadius: 16),
      error: (message) => ErrorState(message: message, onRetry: controller.refresh),
      empty: () => const SizedBox.shrink(),
      success: (insight, isStale, lastUpdated) => Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: LinearGradient(
            colors: [
              context.marketColors.aiAccent.withValues(alpha: 0.55),
              context.marketColors.aiAccent.withValues(alpha: 0.15),
            ],
          ),
        ),
        padding: const EdgeInsets.all(1.5),
        child: AIInsightCard(insight: insight, title: l10n.homeAiBrief),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/network/api_state.dart';
import '../../../../core/widgets/ai_insight_card.dart';
import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_card.dart';
import '../../../../core/widgets/market_data_status_chip.dart';
import '../../../../core/widgets/radar_card.dart';
import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/market_quote.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/ad_banner_slot.dart';
import '../../../gold/presentation/screens/gold_radar_screen.dart';
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
        title: Text(l10n.appName),
        actions: [
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
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            MarketDataStatusChip(mode: controller.mode, lastUpdated: controller.lastUpdated),
            const SizedBox(height: 16),
            Text(l10n.homeMarketPulse, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            _PulseRow(controller: controller),
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
                sparkline: MockMarketCatalog.syntheticSeries('XAU/USD', points: 14),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MarketDetailScreen(symbol: 'XAU/USD')),
                ),
              ),
            const SizedBox(height: 24),
            Text(l10n.homeMarketSnapshot, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            _SnapshotList(controller: controller),
            const SizedBox(height: 16),
            const AdBannerSlot(),
          ],
        ),
      ),
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

class _PulseRow extends StatelessWidget {
  const _PulseRow({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 128,
      child: controller.pulseState.when(
        loading: () => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: 3,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (_, __) => const LoadingSkeleton(width: 156, height: 120, borderRadius: 16),
        ),
        error: (message) => ErrorState(message: message, onRetry: controller.refresh),
        empty: () => const SizedBox.shrink(),
        success: (quotes, isStale, lastUpdated) => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: quotes.length,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (context, index) {
            final quote = quotes[index];
            return MarketCard(
              quote: quote,
              featured: true,
              sparkline: MockMarketCatalog.syntheticSeries(quote.symbol, points: 14),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => MarketDetailScreen(symbol: quote.symbol)),
              ),
            );
          },
        ),
      ),
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
      success: (insight, isStale, lastUpdated) => AIInsightCard(insight: insight, title: l10n.homeAiBrief),
    );
  }
}

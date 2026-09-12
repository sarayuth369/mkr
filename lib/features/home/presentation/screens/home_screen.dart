import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/network/api_state.dart';
import '../../../../core/widgets/ai_insight_card.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_card.dart';
import '../../../../core/widgets/radar_card.dart';
import '../../../../domain/market_quote.dart';
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
    final controller = context.watch<HomeController>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('MKR'),
        actions: [
          IconButton(
            icon: const Icon(Icons.article_outlined),
            tooltip: 'News',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NewsScreen())),
          ),
          IconButton(
            icon: const Icon(Icons.event_note_outlined),
            tooltip: 'Economic Calendar',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CalendarScreen())),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Market Status', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            _StatusRow(controller: controller),
            const SizedBox(height: 24),
            Text("Today's Radar", style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            _RadarSection(controller: controller),
            const SizedBox(height: 24),
            _AiBriefSection(controller: controller),
            const SizedBox(height: 24),
            _SectionHeader(
              title: 'Gold Radar',
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
            Text('US Market', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            _QuoteRow(state: controller.usMarketState),
            const SizedBox(height: 24),
            Text('Crypto', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            _QuoteRow(state: controller.cryptoState),
            const SizedBox(height: 24),
            const AdBannerSlot(),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.onSeeAll});

  final String title;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        TextButton(onPressed: onSeeAll, child: const Text('See all')),
      ],
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 98,
      child: controller.statusState.when(
        loading: () => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: 5,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (_, __) => const LoadingSkeleton(width: 132, height: 90, borderRadius: 16),
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

class _QuoteRow extends StatelessWidget {
  const _QuoteRow({required this.state});

  final ApiState<List<MarketQuote>> state;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 98,
      child: state.when(
        loading: () => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: 4,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (_, __) => const LoadingSkeleton(width: 132, height: 90, borderRadius: 16),
        ),
        error: (message) => ErrorState(message: message),
        empty: () => const SizedBox.shrink(),
        success: (quotes, isStale, lastUpdated) => ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: quotes.length,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (context, index) {
            final quote = quotes[index];
            return MarketCard(
              quote: quote,
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

class _RadarSection extends StatelessWidget {
  const _RadarSection({required this.controller});

  final HomeController controller;

  @override
  Widget build(BuildContext context) {
    return controller.radarState.when(
      loading: () => const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: LoadingSkeletonList(rows: 2, rowHeight: 40)),
      error: (message) => ErrorState(message: message, onRetry: controller.refresh),
      empty: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('Nothing major scheduled today'),
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
    return controller.briefState.when(
      loading: () => const LoadingSkeleton(height: 200, width: double.infinity, borderRadius: 16),
      error: (message) => ErrorState(message: message, onRetry: controller.refresh),
      empty: () => const SizedBox.shrink(),
      success: (insight, isStale, lastUpdated) => AIInsightCard(insight: insight),
    );
  }
}

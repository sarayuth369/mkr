import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/ai_insight_card.dart';
import '../../../../core/widgets/economic_event_card.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/price_chart.dart';
import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/market_quote.dart';
import '../../../../domain/market_trend.dart';
import '../../application/gold_radar_controller.dart';
import '../../domain/gold_radar_data.dart';

class GoldRadarScreen extends StatelessWidget {
  const GoldRadarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<GoldRadarController>();

    return Scaffold(
      appBar: AppBar(title: const Text('Gold Radar')),
      body: RefreshIndicator(
        onRefresh: controller.retry,
        child: controller.state.when(
          loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingSkeletonList(rows: 5)),
          error: (message) => ErrorState(message: message, onRetry: controller.retry),
          empty: () => const Center(child: Text('Gold data unavailable')),
          success: (data, isStale, lastUpdated) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _PriceHeader(data: data),
              const SizedBox(height: 16),
              PriceChart(series: MockMarketCatalog.syntheticSeries('XAU/USD'), isUp: data.gold.isUp),
              const SizedBox(height: 20),
              _MetricsGrid(data: data),
              const SizedBox(height: 20),
              _RelatedMarkets(data: data),
              const SizedBox(height: 20),
              Text('AI: Gold Insight', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              controller.aiState.when(
                loading: () => const LoadingSkeleton(height: 160, width: double.infinity, borderRadius: 16),
                error: (message) => ErrorState(message: message),
                empty: () => const SizedBox.shrink(),
                success: (insight, _, __) => AIInsightCard(insight: insight, title: 'What is driving Gold?'),
              ),
              if (controller.importantEvents.isNotEmpty) ...[
                const SizedBox(height: 20),
                Text('Important Events', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                for (final event in controller.importantEvents)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: EconomicEventCard(event: event),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PriceHeader extends StatelessWidget {
  const _PriceHeader({required this.data});

  final GoldRadarData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = data.gold.isUp ? context.marketColors.gain : context.marketColors.loss;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('XAU/USD · Gold Spot', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(Formatters.price(data.gold.price), style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(width: 10),
            Text(
              '${Formatters.changeAbs(data.gold.changeAbs)} (${Formatters.changePct(data.gold.changePct)})',
              style: TextStyle(color: color, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ],
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.data});

  final GoldRadarData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final metrics = <(String, String)>[
      ('Trend', data.trend.label),
      ('Momentum', data.momentumLabel),
      ('Volatility', data.volatilityLabel),
      ('Support', Formatters.price(data.support)),
      ('Resistance', Formatters.price(data.resistance)),
    ];
    return Wrap(
      spacing: 24,
      runSpacing: 12,
      children: [
        for (final m in metrics)
          SizedBox(
            width: 100,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(m.$1, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                Text(m.$2, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
      ],
    );
  }
}

class _RelatedMarkets extends StatelessWidget {
  const _RelatedMarkets({required this.data});

  final GoldRadarData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final quotes = [data.dxy, data.us10y, data.oil].whereType<MarketQuote>().toList();
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final quote in quotes)
          Container(
            width: 100,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(quote.symbol, style: theme.textTheme.labelSmall),
                Text(Formatters.price(quote.price), style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                Text(
                  Formatters.changePct(quote.changePct),
                  style: TextStyle(
                    color: quote.isUp ? context.marketColors.gain : context.marketColors.loss,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

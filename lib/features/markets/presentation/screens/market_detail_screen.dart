import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ai_insight_card.dart';
import '../../../../core/widgets/candlestick_chart.dart';
import '../../../../core/widgets/day_range_bar.dart';
import '../../../../domain/market_candle.dart';
import '../../../../domain/market_data_mode.dart';
import '../../../../core/widgets/economic_event_card.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_data_status_chip.dart';
import '../../../../core/widgets/market_sentiment_gauge.dart';
import '../../../../core/widgets/news_card.dart';
import '../../../../core/widgets/price_chart.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../domain/market_quote.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/mkr_ad_slot.dart';
import '../../../ai/domain/market_ai_service.dart';
import '../../../alerts/presentation/screens/create_alert_screen.dart';
import '../../../calendar/domain/economic_calendar_service.dart';
import '../../../news/domain/news_service.dart';
import '../../../watchlist/application/watchlist_controller.dart';
import '../../application/market_detail_controller.dart';
import '../../domain/market_service.dart';
import '../../domain/timeframe.dart';

class MarketDetailScreen extends StatelessWidget {
  const MarketDetailScreen({super.key, required this.symbol});

  final String symbol;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (context) => MarketDetailController(
        symbol: symbol,
        marketService: context.read<MarketService>(),
        aiService: context.read<MarketAIService>(),
        newsService: context.read<NewsService>(),
        calendarService: context.read<EconomicCalendarService>(),
      ),
      child: _MarketDetailBody(symbol: symbol),
    );
  }
}

class _MarketDetailBody extends StatelessWidget {
  const _MarketDetailBody({required this.symbol});

  final String symbol;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<MarketDetailController>();
    final watchlist = context.watch<WatchlistController>();
    final marketColors = context.marketColors;
    final inWatchlist = watchlist.contains(symbol);

    return Scaffold(
      appBar: AppBar(
        title: Text(symbol),
        actions: [
          IconButton(
            icon: Icon(inWatchlist ? Icons.star : Icons.star_border),
            tooltip: inWatchlist ? l10n.removeFromWatchlist : l10n.addToWatchlist,
            onPressed: () => inWatchlist ? watchlist.remove(symbol) : watchlist.add(symbol),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_none),
            tooltip: l10n.createAlert,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => CreateAlertScreen(initialSymbol: symbol)),
            ),
          ),
        ],
      ),
      body: MkrAdBody(
        child: controller.quoteState.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingSkeletonList(rows: 4)),
        error: (message) => ErrorState(message: message, onRetry: controller.retry),
        empty: () => Center(child: Text(l10n.marketDetailSymbolNotFound)),
        success: (quote, isStale, lastUpdated) {
          final changeColor = quote.isUp ? marketColors.gain : marketColors.loss;
          return RefreshIndicator(
            onRefresh: controller.retry,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(quote.name, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 6),
                MarketDataStatusChip(mode: controller.mode, lastUpdated: controller.lastUpdated),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      Formatters.price(quote.price, currency: quote.currency == 'USD' ? '' : quote.currency),
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '${Formatters.changeAbs(quote.changeAbs)} (${Formatters.changePct(quote.changePct)})',
                      style: TextStyle(color: changeColor, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _ChartSection(symbol: symbol, controller: controller, isUp: quote.isUp),
                const SizedBox(height: 20),
                MarketSentimentGauge(changePct: quote.changePct),
                if (quote.low != null && quote.high != null) ...[
                  const SizedBox(height: 16),
                  DayRangeBar(label: l10n.marketDetailDayRange, low: quote.low!, high: quote.high!, value: quote.price),
                ],
                if (quote.week52Low != null && quote.week52High != null) ...[
                  const SizedBox(height: 16),
                  DayRangeBar(
                    label: l10n.marketDetail52WeekRange,
                    low: quote.week52Low!,
                    high: quote.week52High!,
                    value: quote.price,
                  ),
                ],
                const SizedBox(height: 20),
                _StatsGrid(quote: quote),
                const SizedBox(height: 20),
                Text(l10n.marketDetailAiInsight, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                controller.aiState.when(
                  loading: () => const LoadingSkeleton(height: 160, width: double.infinity, borderRadius: 16),
                  error: (message) => ErrorState(message: message),
                  empty: () => const SizedBox.shrink(),
                  success: (insight, _, __) => AIInsightCard(insight: insight, title: '$symbol ${l10n.marketDetailAiInsight}'),
                ),
                if (controller.relatedEvents.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(l10n.marketDetailRelatedEvents, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  for (final event in controller.relatedEvents)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: EconomicEventCard(event: event),
                    ),
                ],
                if (controller.relatedNews.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(l10n.marketDetailRelatedNews, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  for (final article in controller.relatedNews)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: NewsCard(article: article),
                    ),
                ],
              ],
            ),
          );
        },
        ),
      ),
      bottomNavigationBar: const MkrBottomBannerAd(),
    );
  }
}

enum _ChartMode { line, candle }

class _ChartSection extends StatefulWidget {
  const _ChartSection({required this.symbol, required this.controller, required this.isUp});

  final String symbol;
  final MarketDetailController controller;
  final bool isUp;

  @override
  State<_ChartSection> createState() => _ChartSectionState();
}

class _ChartSectionState extends State<_ChartSection> {
  _ChartMode _mode = _ChartMode.line;
  Timeframe _candleTimeframe = Timeframe.h1;
  Stream<List<MarketCandle>>? _candleStream;

  @override
  void initState() {
    super.initState();
    _subscribeCandles();
  }

  void _subscribeCandles() {
    _candleStream = context.read<MarketService>().watchCandles(widget.symbol, _candleTimeframe);
  }

  void _changeCandleTimeframe(Timeframe timeframe) {
    setState(() {
      _candleTimeframe = timeframe;
      _subscribeCandles();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: SegmentedButton<_ChartMode>(
            segments: [
              ButtonSegment(value: _ChartMode.line, label: Text(l10n.chartModeLine), icon: const Icon(Icons.show_chart, size: 16)),
              ButtonSegment(value: _ChartMode.candle, label: Text(l10n.chartModeCandle), icon: const Icon(Icons.candlestick_chart_outlined, size: 16)),
            ],
            selected: {_mode},
            onSelectionChanged: (s) => setState(() => _mode = s.first),
          ),
        ),
        const SizedBox(height: 12),
        if (_mode == _ChartMode.line)
          widget.controller.seriesUnavailable
              ? SizedBox(
                  height: 180,
                  child: Center(
                    child: TextButton(
                      onPressed: () => widget.controller.loadSeries(widget.controller.timeframe),
                      child: Text(l10n.chartSeriesUnavailable),
                    ),
                  ),
                )
              : PriceChart(
                  series: widget.controller.series,
                  isUp: widget.isUp,
                  onTimeframeChanged: widget.controller.loadSeries,
                )
        else ...[
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final tf in Timeframe.values)
                _CandleTimeframeChip(
                  label: tf.label,
                  selected: tf == _candleTimeframe,
                  onTap: () => _changeCandleTimeframe(tf),
                ),
            ],
          ),
          const SizedBox(height: 10),
          StreamBuilder<List<MarketCandle>>(
            stream: _candleStream,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const LoadingSkeleton(height: 220, width: double.infinity, borderRadius: 12);
              }
              final candles = snapshot.data ?? const <MarketCandle>[];
              if (candles.length < 2) {
                return SizedBox(
                  height: 220,
                  child: Center(
                    child: Text(l10n.chartCandleEmpty, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  ),
                );
              }
              return CandlestickChart(
                candles: candles,
                isStale: widget.controller.mode == MarketDataMode.stale,
              );
            },
          ),
          const SizedBox(height: 6),
          Text(
            l10n.chartCandleCaption,
            style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ],
    );
  }
}

class _CandleTimeframeChip extends StatelessWidget {
  const _CandleTimeframeChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? theme.colorScheme.primaryContainer : Colors.transparent,
          border: Border.all(color: selected ? Colors.transparent : theme.colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: selected ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.quote});

  final MarketQuote quote;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final stats = <(String, String?)>[
      (l10n.marketDetailOpen, quote.open != null ? Formatters.price(quote.open!) : null),
      (l10n.marketDetailPrevClose, quote.prevClose != null ? Formatters.price(quote.prevClose!) : null),
      (l10n.marketDetailHigh, quote.high != null ? Formatters.price(quote.high!) : null),
      (l10n.marketDetailLow, quote.low != null ? Formatters.price(quote.low!) : null),
      (l10n.marketDetailVolume, quote.volume != null ? Formatters.volume(quote.volume!) : null),
    ].where((s) => s.$2 != null).toList();

    if (stats.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: 24,
      runSpacing: 12,
      children: [
        for (final stat in stats)
          SizedBox(
            width: 100,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(stat.$1, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                Text(stat.$2!, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
      ],
    );
  }
}

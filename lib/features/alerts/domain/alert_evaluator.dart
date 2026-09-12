import '../../../domain/market_quote.dart';
import '../../../domain/market_trend.dart';
import 'alert.dart';

RadarTransition? _transitionFor(MarketTrend from, MarketTrend to) {
  if (from == MarketTrend.neutral && to == MarketTrend.bullish) return RadarTransition.neutralToBullish;
  if (from == MarketTrend.neutral && to == MarketTrend.bearish) return RadarTransition.neutralToBearish;
  if (from == MarketTrend.bullish && to == MarketTrend.neutral) return RadarTransition.bullishToNeutral;
  if (from == MarketTrend.bearish && to == MarketTrend.neutral) return RadarTransition.bearishToNeutral;
  return null;
}

/// Pure, side-effect-free evaluation of which alerts should fire given a
/// snapshot of current market data. Kept separate from any repository or
/// timer so it is trivially unit-testable.
class AlertEvaluator {
  AlertEvaluator._();

  static List<String> evaluate({
    required List<Alert> alerts,
    Map<String, MarketQuote> quotes = const {},
    List<String> todaysEventTitles = const [],
    Map<String, MarketTrend> previousTrends = const {},
    Map<String, MarketTrend> currentTrends = const {},
  }) {
    final triggered = <String>[];
    for (final alert in alerts) {
      if (!alert.isEnabled) continue;
      final fires = switch (alert.type) {
        AlertType.price => _evaluatePrice(alert, quotes),
        AlertType.percentage => _evaluatePercentage(alert, quotes),
        AlertType.event => _evaluateEvent(alert, todaysEventTitles),
        AlertType.radar => _evaluateRadar(alert, previousTrends, currentTrends),
      };
      if (fires) triggered.add(alert.id);
    }
    return triggered;
  }

  static bool _evaluatePrice(Alert alert, Map<String, MarketQuote> quotes) {
    final quote = quotes[alert.symbol];
    if (quote == null || alert.priceTarget == null || alert.priceDirection == null) return false;
    return alert.priceDirection == PriceDirection.above
        ? quote.price >= alert.priceTarget!
        : quote.price <= alert.priceTarget!;
  }

  static bool _evaluatePercentage(Alert alert, Map<String, MarketQuote> quotes) {
    final quote = quotes[alert.symbol];
    if (quote == null || alert.percentageThreshold == null) return false;
    return quote.changePct.abs() >= alert.percentageThreshold!;
  }

  static bool _evaluateEvent(Alert alert, List<String> todaysEventTitles) {
    final keyword = alert.eventKeyword?.toLowerCase();
    if (keyword == null || keyword.isEmpty) return false;
    return todaysEventTitles.any((title) => title.toLowerCase().contains(keyword));
  }

  static bool _evaluateRadar(
    Alert alert,
    Map<String, MarketTrend> previousTrends,
    Map<String, MarketTrend> currentTrends,
  ) {
    final previous = previousTrends[alert.symbol];
    final current = currentTrends[alert.symbol];
    if (previous == null || current == null || alert.radarTransition == null) return false;
    return _transitionFor(previous, current) == alert.radarTransition;
  }
}

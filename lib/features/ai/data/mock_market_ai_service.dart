import '../../../data/mock_market_catalog.dart';
import '../../calendar/domain/economic_event.dart';
import '../../news/domain/news_article.dart';
import '../domain/ai_insight.dart';
import '../domain/market_ai_service.dart';

/// Deterministic template-based mock — swap for a real Cloudflare Worker
/// client later without touching any caller.
class MockMarketAIService implements MarketAIService {
  @override
  Future<AIInsight> getDailyBrief() async {
    await Future.delayed(const Duration(milliseconds: 400));
    return AIInsight(
      summary:
          'Markets are mixed heading into today\'s session. Gold holds firm '
          'near recent highs while US equities digest a busy data calendar.',
      whyItMatters:
          'Today\'s CPI print and a scheduled Fed speech are the two biggest '
          'catalysts — both can move rate expectations quickly, which ripples '
          'into equities, gold and the dollar.',
      marketImpact:
          'A softer-than-expected inflation reading would likely support '
          'risk assets and gold together; a hotter reading could pressure '
          'equities and lift the dollar.',
      whatToWatch: const [
        'US CPI release at 19:30',
        'Fed speech at 21:00',
        'DXY reaction around the print',
      ],
      risks: const [
        'Data surprises can reverse intraday moves quickly',
        'Thin liquidity can exaggerate volatility around the release',
      ],
      generatedAt: DateTime.now(),
    );
  }

  @override
  Future<AIInsight> getAssetInsight(String symbol) async {
    await Future.delayed(const Duration(milliseconds: 300));
    final quote = MockMarketCatalog.bySymbol(symbol);
    final direction = (quote?.isUp ?? true) ? 'higher' : 'lower';
    return AIInsight(
      summary:
          '${quote?.name ?? symbol} is trading $direction, tracking broader '
          'sentiment in its asset class today.',
      whyItMatters:
          'Recent moves in $symbol reflect a mix of macro positioning and '
          'sector flows rather than any single headline.',
      marketImpact:
          'Continued momentum in $symbol could influence related assets in '
          'the same category over the near term.',
      whatToWatch: [
        'Upcoming scheduled events affecting $symbol',
        'Broader market risk sentiment',
      ],
      risks: const [
        'Macro surprises can quickly change the picture',
        'Past movement does not guarantee future direction',
      ],
      generatedAt: DateTime.now(),
    );
  }

  @override
  Future<AIInsight> summarizeNews(NewsArticle article) async {
    await Future.delayed(const Duration(milliseconds: 250));
    return AIInsight(
      summary: article.summary,
      whyItMatters:
          'This ${article.category.toLowerCase()} story is rated '
          '${article.impact.name.toUpperCase()} impact for '
          '${article.affectedAssets.join(', ')}.',
      marketImpact: 'Potential short-term volatility in the affected assets.',
      whatToWatch: [
        for (final asset in article.affectedAssets) 'Reaction in $asset',
      ],
      risks: const ['Headlines can be revised or clarified later'],
      generatedAt: DateTime.now(),
    );
  }

  @override
  Future<AIInsight> analyzeMarketImpact(EconomicEvent event) async {
    await Future.delayed(const Duration(milliseconds: 250));
    return AIInsight(
      summary:
          '${event.title} (${event.country}) is a ${event.impact.name.toUpperCase()} '
          'impact event on the calendar.',
      whyItMatters:
          'Events like this can shift rate expectations and cross-asset '
          'positioning depending on how the actual compares to forecast.',
      marketImpact:
          'A beat or miss versus the ${event.forecast ?? "forecast"} could '
          'move currencies, rates-sensitive equities and gold.',
      whatToWatch: const ['Actual vs. forecast on release', 'Follow-up commentary'],
      risks: const ['Revisions to prior data can also move markets'],
      generatedAt: DateTime.now(),
    );
  }
}

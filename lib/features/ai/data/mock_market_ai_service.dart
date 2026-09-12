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

  @override
  Future<String> ask(String question) async {
    await Future.delayed(const Duration(milliseconds: 500));
    final q = question.toLowerCase();

    if (q.contains('gold') || q.contains('xau')) {
      final gold = MockMarketCatalog.bySymbol('XAU/USD');
      return 'Gold is trading near ${gold != null ? gold.price.toStringAsFixed(2) : 'recent levels'}, '
          'supported by a softer dollar and steady central-bank demand. Key '
          'levels to watch are the recent support and resistance zones — a '
          'break either way often follows real-yield and dollar moves.\n\n'
          'This is analysis for context, not a guarantee of future direction.';
    }
    if (q.contains('fed') || q.contains('rate') || q.contains('fomc')) {
      return 'The Fed\'s tone on rates is a major driver for equities, gold '
          'and the dollar. A more cautious (dovish) tone tends to support '
          'risk assets and gold; a firmer (hawkish) tone tends to lift the '
          'dollar and pressure rate-sensitive sectors.\n\n'
          'Watch the policy statement language and the press conference Q&A '
          'for the market\'s actual read — headlines alone can be misleading.';
    }
    if (q.contains('nvda') || q.contains('nvidia')) {
      final nvda = MockMarketCatalog.bySymbol('NVDA');
      return 'NVDA has been moving on AI-infrastructure demand commentary '
          'and broader semiconductor sentiment${nvda != null ? ' — currently around ${nvda.price.toStringAsFixed(2)}' : ''}. '
          'Earnings updates and data-center spending trends from major '
          'customers are the main things influencing sentiment right now.\n\n'
          'Individual stock moves can be volatile — this is context, not a recommendation.';
    }
    if ((q.contains('qqq') && q.contains('spy')) || (q.contains('compare') && q.contains('etf'))) {
      return 'QQQ tracks the Nasdaq-100 (tech/growth heavy), while SPY tracks '
          'the S&P 500 (broader, more diversified across sectors). QQQ '
          'typically shows larger swings in both directions since it is more '
          'concentrated in a smaller number of large tech names.\n\n'
          'Which fits better depends on your own diversification and risk '
          'tolerance — this is educational context, not a recommendation.';
    }
    if (q.contains('dollar') || q.contains('dxy') || q.contains('usd')) {
      return 'The US dollar and gold often move inversely: since gold is '
          'priced in dollars, a weaker dollar makes gold cheaper for holders '
          'of other currencies (supportive of price), while a stronger '
          'dollar tends to weigh on gold. Real (inflation-adjusted) US '
          'yields are the other major driver.\n\n'
          'This relationship is a general tendency, not a fixed rule.';
    }
    if (q.contains('crypto') || q.contains('bitcoin') || q.contains('btc')) {
      final btc = MockMarketCatalog.bySymbol('BTC');
      return 'Crypto markets are trading with elevated volatility${btc != null ? ', with BTC around ${btc.price.toStringAsFixed(0)}' : ''}. '
          'Flows into spot ETFs, broader risk sentiment, and liquidity '
          'conditions are the main things moving prices at the moment.\n\n'
          'Crypto remains a high-volatility asset class — treat any single '
          'data point as context, not certainty.';
    }
    if (q.contains('portfolio') || q.contains('diversif')) {
      return 'Diversification generally means spreading exposure across '
          'asset classes (equities, gold, bonds, cash) and regions so that no '
          'single event drives your whole outcome. The right mix depends on '
          'your own goals, time horizon and risk tolerance.\n\n'
          'This is general education, not personalized financial advice.';
    }

    return 'Markets are digesting a mix of macro data, earnings and central '
        'bank commentary right now. The clearest way to stay oriented is to '
        'watch the highest-impact items on today\'s economic calendar and '
        'how price reacts around them, rather than any single headline.\n\n'
        'This is general market context — not financial advice, and not a '
        'guarantee of any outcome.';
  }
}

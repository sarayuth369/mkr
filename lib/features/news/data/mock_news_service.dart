import '../../../domain/impact_level.dart';
import '../domain/news_article.dart';
import '../domain/news_service.dart';

class MockNewsService implements NewsService {
  static final List<NewsArticle> _articles = [
    NewsArticle(
      id: 'n1',
      headline: 'US inflation falls more than expected',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(minutes: 42)),
      category: 'Macro',
      impact: ImpactLevel.high,
      affectedAssets: const ['Gold', 'Nasdaq', 'USD'],
      summary: 'Headline CPI cooled versus consensus, reviving bets on '
          'slower-for-longer rate policy and lifting rate-sensitive assets.',
    ),
    NewsArticle(
      id: 'n2',
      headline: 'Gold holds near record highs as dollar softens',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(hours: 2)),
      category: 'Commodities',
      impact: ImpactLevel.medium,
      affectedAssets: const ['Gold', 'DXY'],
      summary: 'Bullion stayed firm as the dollar index slipped, with '
          'traders positioning ahead of upcoming central bank commentary.',
    ),
    NewsArticle(
      id: 'n3',
      headline: 'NVIDIA extends rally on AI demand commentary',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(hours: 4)),
      category: 'Equities',
      impact: ImpactLevel.medium,
      affectedAssets: const ['NVDA', 'Nasdaq', 'QQQ'],
      summary: 'Shares extended gains after industry commentary pointed to '
          'continued strong demand for AI infrastructure.',
    ),
    NewsArticle(
      id: 'n4',
      headline: 'Bitcoin reclaims key level amid renewed inflows',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(hours: 6)),
      category: 'Crypto',
      impact: ImpactLevel.medium,
      affectedAssets: const ['BTC', 'ETH'],
      summary: 'Digital assets pushed higher as flow data showed renewed '
          'buying interest across major exchanges.',
    ),
    NewsArticle(
      id: 'n5',
      headline: 'Oil slips on demand concerns ahead of inventory data',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(hours: 9)),
      category: 'Commodities',
      impact: ImpactLevel.low,
      affectedAssets: const ['OIL'],
      summary: 'Crude prices eased as traders positioned defensively ahead '
          'of the next inventory report.',
    ),
    NewsArticle(
      id: 'n6',
      headline: 'SET index drifts lower in quiet regional trade',
      source: 'MKR Wire (mock)',
      timestamp: DateTime.now().subtract(const Duration(hours: 11)),
      category: 'Regional',
      impact: ImpactLevel.low,
      affectedAssets: const ['SET', 'SET50'],
      summary: 'Thai equities traded in a narrow range with volumes below '
          'the recent average.',
    ),
  ];

  @override
  Future<List<NewsArticle>> getNews() async {
    await Future.delayed(const Duration(milliseconds: 350));
    return List.unmodifiable(_articles);
  }

  @override
  Future<List<NewsArticle>> getRelatedTo(String symbolOrAssetName) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return _articles
        .where((a) => a.affectedAssets.any(
              (asset) => asset.toLowerCase() == symbolOrAssetName.toLowerCase(),
            ))
        .toList();
  }
}

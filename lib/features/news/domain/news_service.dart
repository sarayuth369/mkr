import 'news_article.dart';

/// Production path: Flutter → Cloudflare Worker → news provider(s), with the
/// worker doing categorization/impact tagging. Never fabricate real
/// headlines — mock articles must always carry [NewsArticle.isMock].
abstract class NewsService {
  /// Whether this implementation serves mock/demo content — screens use
  /// this (not a per-article check) to decide whether to show the "demo
  /// data" banner, matching the same pattern [MarketService.mode] already
  /// uses for market data.
  bool get isMock;

  Future<List<NewsArticle>> getNews();

  Future<List<NewsArticle>> getRelatedTo(String symbolOrAssetName);
}

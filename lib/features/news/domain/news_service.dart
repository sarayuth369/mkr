import 'news_article.dart';

/// Production path: Flutter → Cloudflare Worker → news provider(s), with the
/// worker doing categorization/impact tagging. Never fabricate real
/// headlines — mock articles must always carry [NewsArticle.isMock].
abstract class NewsService {
  Future<List<NewsArticle>> getNews();

  Future<List<NewsArticle>> getRelatedTo(String symbolOrAssetName);
}

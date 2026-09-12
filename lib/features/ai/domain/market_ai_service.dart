import '../../calendar/domain/economic_event.dart';
import '../../news/domain/news_article.dart';
import 'ai_insight.dart';

/// AI abstraction the whole app talks to. In production this call goes
/// Flutter → Cloudflare Worker → AI provider; the client never holds an AI
/// API key. Phase 1 is served entirely by [MockMarketAIService].
///
/// Output is always descriptive (summary / why it matters / market impact /
/// what to watch / risks) — implementations must never emit a direct
/// buy/sell instruction or present a prediction as guaranteed.
abstract class MarketAIService {
  Future<AIInsight> getDailyBrief();

  Future<AIInsight> getAssetInsight(String symbol);

  Future<AIInsight> summarizeNews(NewsArticle article);

  Future<AIInsight> analyzeMarketImpact(EconomicEvent event);
}

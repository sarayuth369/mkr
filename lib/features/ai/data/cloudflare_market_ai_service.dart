import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../calendar/domain/economic_event.dart';
import '../../news/domain/news_article.dart';
import '../domain/ai_insight.dart';
import '../domain/market_ai_service.dart';

/// Thrown when the backend reports a clean, expected failure (feature
/// flag off, invalid input, AI provider unavailable) - carries the
/// backend's own message so [AiAskController]/[HomeController]'s existing
/// `catch (e) { ...e.toString()... }` error paths show something
/// meaningful rather than a raw HTTP/parsing exception.
class MarketAIException implements Exception {
  const MarketAIException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Real [MarketAIService] backed by the MKR Cloudflare Worker's `/api/mkr/ai/*`
/// routes (Cloudflare Workers AI under the hood - see backend/src/ai/ai-routes.ts).
/// Never calls an AI provider directly and never holds a key - same
/// backend-gateway pattern as [TwelveDataProvider] for market data.
///
/// Every method throws (never returns a fabricated/fallback insight) when
/// the backend reports the `aiBriefEnabled` feature flag is off or the AI
/// call otherwise fails - [MarketAIService]'s Future-returning, non-nullable
/// contract has no other way to signal "unavailable", and both callers
/// (HomeController, AiAskController) already handle that via their existing
/// try/catch → error-state paths.
class CloudflareMarketAIService implements MarketAIService {
  CloudflareMarketAIService({required this.backendBaseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String backendBaseUrl;
  final http.Client _http;

  Uri _uri(String path) => Uri.parse('$backendBaseUrl$path');

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final http.Response response;
    try {
      response = await _http.post(_uri(path), headers: const {'Content-Type': 'application/json'}, body: jsonEncode(body));
    } catch (_) {
      throw const MarketAIException('Could not reach the AI service. Check your connection and try again.');
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw const MarketAIException('The AI service returned an unexpected response.');
    }
    if (decoded is! Map<String, dynamic>) {
      throw const MarketAIException('The AI service returned an unexpected response.');
    }
    if (decoded['success'] != true) {
      final error = decoded['error'];
      final message = error is Map && error['message'] is String ? error['message'] as String : 'The AI service is currently unavailable.';
      throw MarketAIException(message);
    }
    final data = decoded['data'];
    if (data is! Map<String, dynamic>) {
      throw const MarketAIException('The AI service returned an unexpected response.');
    }
    return data;
  }

  AIInsight _insightFrom(Map<String, dynamic> data) {
    return AIInsight(
      summary: data['summary'] as String? ?? '',
      whyItMatters: data['whyItMatters'] as String? ?? '',
      marketImpact: data['marketImpact'] as String? ?? '',
      whatToWatch: (data['whatToWatch'] as List<dynamic>? ?? const []).whereType<String>().toList(),
      risks: (data['risks'] as List<dynamic>? ?? const []).whereType<String>().toList(),
      generatedAt: DateTime.now(),
    );
  }

  @override
  Future<AIInsight> getDailyBrief() async {
    final data = await _post('/api/mkr/ai/brief', const {});
    return _insightFrom(data);
  }

  @override
  Future<AIInsight> getAssetInsight(String symbol) async {
    final data = await _post('/api/mkr/ai/asset-insight', {'symbol': symbol});
    return _insightFrom(data);
  }

  @override
  Future<AIInsight> summarizeNews(NewsArticle article) async {
    final data = await _post('/api/mkr/ai/news-summary', {
      'headline': article.headline,
      'summary': article.summary,
      'category': article.category,
    });
    return _insightFrom(data);
  }

  @override
  Future<AIInsight> analyzeMarketImpact(EconomicEvent event) async {
    final data = await _post('/api/mkr/ai/event-impact', {
      'title': event.title,
      'country': event.country,
      'previous': event.previous,
      'forecast': event.forecast,
      'actual': event.actual,
    });
    return _insightFrom(data);
  }

  @override
  Future<String> ask(String question) async {
    final data = await _post('/api/mkr/ai/ask', {'question': question});
    return data['answer'] as String? ?? '';
  }
}

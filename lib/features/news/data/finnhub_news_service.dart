import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../domain/impact_level.dart';
import '../domain/news_article.dart';
import '../domain/news_service.dart';

/// Real [NewsService] backed by the MKR Cloudflare Worker's `/api/mkr/news*`
/// routes (Finnhub under the hood - see backend/src/news/news-routes.ts).
/// Never calls Finnhub directly and never holds a key - same backend-gateway
/// pattern as [TwelveDataProvider]/[CloudflareMarketAIService].
///
/// Throws when the backend reports `newsEnabled` is off or the call
/// otherwise fails - [NewsController.refresh] already wraps every call in
/// try/catch and surfaces an error state, same contract as every other real
/// service in this app.
class FinnhubNewsService implements NewsService {
  FinnhubNewsService({required this.backendBaseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String backendBaseUrl;
  final http.Client _http;

  @override
  bool get isMock => false;

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse('$backendBaseUrl$path').replace(queryParameters: query);

  Future<List<dynamic>> _getList(Uri uri) async {
    final http.Response response;
    try {
      response = await _http.get(uri);
    } catch (_) {
      throw Exception('Could not reach the news service. Check your connection and try again.');
    }

    final dynamic decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic> || decoded['success'] != true) {
      final error = decoded is Map ? decoded['error'] : null;
      final message = error is Map && error['message'] is String ? error['message'] as String : 'The news service is currently unavailable.';
      throw Exception(message);
    }
    final data = decoded['data'];
    return data is List ? data : const [];
  }

  NewsArticle _articleFrom(Map<String, dynamic> json) {
    return NewsArticle(
      id: json['id'] as String? ?? '',
      headline: json['headline'] as String? ?? '',
      source: json['source'] as String? ?? 'Finnhub',
      timestamp: DateTime.fromMillisecondsSinceEpoch((json['timestamp'] as num?)?.toInt() ?? 0),
      category: json['category'] as String? ?? 'General',
      impact: _impactFrom(json['impact'] as String?),
      affectedAssets: (json['affectedAssets'] as List<dynamic>? ?? const []).whereType<String>().toList(),
      summary: json['summary'] as String? ?? '',
      isMock: false,
    );
  }

  ImpactLevel _impactFrom(String? value) => switch (value) {
        'high' => ImpactLevel.high,
        'medium' => ImpactLevel.medium,
        _ => ImpactLevel.low,
      };

  @override
  Future<List<NewsArticle>> getNews() async {
    final items = await _getList(_uri('/api/mkr/news'));
    return items.whereType<Map<String, dynamic>>().map(_articleFrom).toList();
  }

  @override
  Future<List<NewsArticle>> getRelatedTo(String symbolOrAssetName) async {
    final items = await _getList(_uri('/api/mkr/news/related', {'symbol': symbolOrAssetName}));
    return items.whereType<Map<String, dynamic>>().map(_articleFrom).toList();
  }
}

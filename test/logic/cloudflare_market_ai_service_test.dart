import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/features/ai/data/cloudflare_market_ai_service.dart';
import 'package:mkr/features/calendar/domain/economic_event.dart';
import 'package:mkr/features/news/domain/news_article.dart';
import 'package:mkr/domain/impact_level.dart';

http.Response _jsonResponse(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

const _validInsightJson = {
  'summary': 'Markets are mixed today.',
  'whyItMatters': 'Rates and inflation data are in focus.',
  'marketImpact': 'Gold firm, equities mixed.',
  'whatToWatch': ['CPI print', 'Fed presser'],
  'risks': ['Volatility around the data release'],
};

void main() {
  group('CloudflareMarketAIService', () {
    test('getDailyBrief() posts to /api/mkr/ai/brief and maps a successful envelope to AIInsight', () async {
      Uri? calledUri;
      String? calledBody;
      final client = MockClient((request) async {
        calledUri = request.url;
        calledBody = request.body;
        return _jsonResponse({'success': true, 'data': _validInsightJson});
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final insight = await service.getDailyBrief();

      expect(calledUri.toString(), 'https://backend.example.com/api/mkr/ai/brief');
      expect(calledBody, '{}');
      expect(insight.summary, 'Markets are mixed today.');
      expect(insight.whyItMatters, 'Rates and inflation data are in focus.');
      expect(insight.marketImpact, 'Gold firm, equities mixed.');
      expect(insight.whatToWatch, ['CPI print', 'Fed presser']);
      expect(insight.risks, ['Volatility around the data release']);
    });

    test('getAssetInsight(symbol) sends the symbol in the request body', () async {
      Map<String, dynamic>? sentBody;
      final client = MockClient((request) async {
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _jsonResponse({'success': true, 'data': _validInsightJson});
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await service.getAssetInsight('XAU/USD');

      expect(sentBody, {'symbol': 'XAU/USD'});
    });

    test('summarizeNews(article) sends headline/summary/category', () async {
      Map<String, dynamic>? sentBody;
      final client = MockClient((request) async {
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _jsonResponse({'success': true, 'data': _validInsightJson});
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);
      final article = NewsArticle(
        id: 'n1',
        headline: 'Gold hits record high',
        source: 'MKR Wire',
        timestamp: DateTime(2026, 1, 1),
        category: 'Commodities',
        impact: ImpactLevel.medium,
        affectedAssets: const ['Gold'],
        summary: 'Bullion rallied on rate-cut bets.',
      );

      await service.summarizeNews(article);

      expect(sentBody, {'headline': 'Gold hits record high', 'summary': 'Bullion rallied on rate-cut bets.', 'category': 'Commodities'});
    });

    test('analyzeMarketImpact(event) sends title/country/previous/forecast/actual', () async {
      Map<String, dynamic>? sentBody;
      final client = MockClient((request) async {
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _jsonResponse({'success': true, 'data': _validInsightJson});
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);
      final event = EconomicEvent(
        id: 'e1',
        dateTime: DateTime(2026, 1, 1, 19, 30),
        country: 'US',
        title: 'US CPI (YoY)',
        impact: ImpactLevel.high,
        previous: '3.1%',
        forecast: '2.9%',
      );

      await service.analyzeMarketImpact(event);

      expect(sentBody, {'title': 'US CPI (YoY)', 'country': 'US', 'previous': '3.1%', 'forecast': '2.9%', 'actual': null});
    });

    test('ask(question) returns the plain-text answer field, not a structured insight', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': true,
          'data': {'answer': 'Gold is a precious metal often used as a hedge.'},
        });
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final answer = await service.ask('What is gold?');

      expect(answer, 'Gold is a precious metal often used as a hedge.');
    });

    test('throws MarketAIException carrying the backend\'s own message when the feature flag is off', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': false,
          'error': {'code': 'FEATURE_DISABLED', 'message': 'AI features are not enabled on this deployment.'},
        }, status: 503);
      });
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(
        service.getDailyBrief(),
        throwsA(isA<MarketAIException>().having((e) => e.message, 'message', 'AI features are not enabled on this deployment.')),
      );
    });

    test('throws a clean MarketAIException (not a raw exception) when the HTTP call itself fails', () async {
      final client = MockClient((request) async => throw Exception('socket closed'));
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(service.ask('anything'), throwsA(isA<MarketAIException>()));
    });

    test('throws MarketAIException when the response body is not the expected JSON shape', () async {
      final client = MockClient((request) async => http.Response('not json at all', 200));
      final service = CloudflareMarketAIService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(service.getDailyBrief(), throwsA(isA<MarketAIException>()));
    });
  });
}

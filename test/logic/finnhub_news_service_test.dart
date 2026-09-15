import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mkr/domain/impact_level.dart';
import 'package:mkr/features/news/data/finnhub_news_service.dart';

http.Response _jsonResponse(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status, headers: const {'content-type': 'application/json'});

const _article = {
  'id': 'n1',
  'headline': 'Gold hits record high',
  'source': 'Reuters',
  'timestamp': 1700000000000,
  'category': 'Commodities',
  'impact': 'high',
  'affectedAssets': ['GOLD', 'XAU'],
  'summary': 'Bullion rallied on rate-cut bets.',
};

void main() {
  group('FinnhubNewsService', () {
    test('isMock is false - never confused with the demo service', () {
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com');
      expect(service.isMock, isFalse);
    });

    test('getNews() calls /api/mkr/news and maps a successful envelope to NewsArticle, marked isMock: false', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse({
          'success': true,
          'data': [_article],
        });
      });
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final articles = await service.getNews();

      expect(calledUri.toString(), 'https://backend.example.com/api/mkr/news');
      expect(articles, hasLength(1));
      expect(articles.single.headline, 'Gold hits record high');
      expect(articles.single.source, 'Reuters');
      expect(articles.single.category, 'Commodities');
      expect(articles.single.impact, ImpactLevel.high);
      expect(articles.single.affectedAssets, ['GOLD', 'XAU']);
      expect(articles.single.summary, 'Bullion rallied on rate-cut bets.');
      expect(articles.single.isMock, isFalse);
      expect(articles.single.timestamp, DateTime.fromMillisecondsSinceEpoch(1700000000000));
    });

    test('getRelatedTo(symbol) calls /api/mkr/news/related with the symbol as a query parameter', () async {
      Uri? calledUri;
      final client = MockClient((request) async {
        calledUri = request.url;
        return _jsonResponse({'success': true, 'data': <dynamic>[]});
      });
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await service.getRelatedTo('XAU/USD');

      expect(calledUri?.path, '/api/mkr/news/related');
      expect(calledUri?.queryParameters['symbol'], 'XAU/USD');
    });

    test('maps unrecognized/missing impact to low, never fabricating high', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': true,
          'data': [
            {..._article, 'impact': 'unknown-value'},
          ],
        });
      });
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      final articles = await service.getNews();

      expect(articles.single.impact, ImpactLevel.low);
    });

    test('throws carrying the backend\'s own message when the feature flag is off', () async {
      final client = MockClient((request) async {
        return _jsonResponse({
          'success': false,
          'error': {'code': 'FEATURE_DISABLED', 'message': 'News is not enabled on this deployment.'},
        }, status: 503);
      });
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(
        service.getNews(),
        throwsA(predicate((e) => e.toString().contains('News is not enabled on this deployment.'))),
      );
    });

    test('throws a clean exception (not a raw one) when the HTTP call itself fails', () async {
      final client = MockClient((request) async => throw Exception('socket closed'));
      final service = FinnhubNewsService(backendBaseUrl: 'https://backend.example.com', httpClient: client);

      await expectLater(service.getNews(), throwsException);
    });
  });
}

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/impact_level.dart';
import 'package:mkr/features/news/application/news_controller.dart';
import 'package:mkr/features/news/domain/news_article.dart';
import 'package:mkr/features/news/domain/news_service.dart';

// 2026-09-16 Final Full-System One-Pass audit finding: refresh() had no
// request-generation guard, so a slower, older fetch (e.g. a double-tap
// pull-to-refresh) could land after and silently overwrite a newer call's
// already-applied state - the same class of bug already fixed elsewhere via
// MarketsController._loadRequestId.

NewsArticle _article(String id) => NewsArticle(
      id: id,
      headline: id,
      source: 'test',
      timestamp: DateTime.utc(2026, 1, 1),
      category: 'markets',
      impact: ImpactLevel.medium,
      affectedAssets: const [],
      summary: id,
      isMock: false,
    );

class _DelayedNewsService implements NewsService {
  @override
  bool get isMock => false;

  int _calls = 0;

  @override
  Future<List<NewsArticle>> getNews() async {
    _calls++;
    final isFirstCall = _calls == 1;
    await Future<void>.delayed(isFirstCall ? const Duration(milliseconds: 50) : Duration.zero);
    return [_article(isFirstCall ? 'first' : 'second')];
  }

  @override
  Future<List<NewsArticle>> getRelatedTo(String symbolOrAssetName) async => const [];
}

void main() {
  group('NewsController — 2026-09-16 Final Full-System One-Pass audit: stale-response race guard', () {
    test('an older, slower refresh() call never overwrites a newer one\'s already-applied result', () async {
      final service = _DelayedNewsService();
      final controller = NewsController(service);
      // Constructor already started the first (slow) refresh(). Fire a
      // second, faster refresh() immediately, before the first resolves.
      unawaited(controller.refresh());
      await Future<void>.delayed(const Duration(milliseconds: 100));

      final articles = controller.state.dataOrNull;
      expect(articles, isNotNull);
      expect(articles!.single.id, 'second'); // the newer call's result - never clobbered by the slower first call landing late
    });
  });
}

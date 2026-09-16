import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../domain/news_article.dart';
import '../domain/news_service.dart';

class NewsController extends ChangeNotifier {
  NewsController(this._service) {
    refresh();
  }

  final NewsService _service;

  bool get isMock => _service.isMock;

  ApiState<List<NewsArticle>> _state = const ApiState.loading();
  ApiState<List<NewsArticle>> get state => _state;

  /// 2026-09-16 Final Full-System One-Pass audit finding: without this, a
  /// slower, older `refresh()` call (e.g. a double-tap pull-to-refresh)
  /// could land after and overwrite a newer call's already-applied result -
  /// the same request-generation guard pattern already established in
  /// MarketsController._loadRequestId.
  int _refreshRequestId = 0;

  Future<void> refresh() async {
    final requestId = ++_refreshRequestId;
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final articles = await _service.getNews();
      if (requestId != _refreshRequestId) return;
      _state = articles.isEmpty ? const ApiState.empty() : ApiState.success(articles);
    } catch (e) {
      if (requestId != _refreshRequestId) return;
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
  }
}

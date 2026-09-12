import 'package:flutter/foundation.dart';

import '../../../core/network/api_state.dart';
import '../domain/news_article.dart';
import '../domain/news_service.dart';

class NewsController extends ChangeNotifier {
  NewsController(this._service) {
    refresh();
  }

  final NewsService _service;

  ApiState<List<NewsArticle>> _state = const ApiState.loading();
  ApiState<List<NewsArticle>> get state => _state;

  Future<void> refresh() async {
    _state = const ApiState.loading();
    notifyListeners();
    try {
      final articles = await _service.getNews();
      _state = articles.isEmpty ? const ApiState.empty() : ApiState.success(articles);
    } catch (e) {
      _state = ApiState.error(e.toString());
    }
    notifyListeners();
  }
}

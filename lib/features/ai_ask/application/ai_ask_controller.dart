import 'package:flutter/foundation.dart';

import '../../ai/domain/market_ai_service.dart';
import '../domain/chat_message.dart';

class AiAskController extends ChangeNotifier {
  AiAskController(this._service);

  final MarketAIService _service;
  int _nextId = 0;

  final List<ChatMessage> _messages = [];
  List<ChatMessage> get messages => List.unmodifiable(_messages);

  bool _isResponding = false;
  bool get isResponding => _isResponding;

  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || _isResponding) return;

    _messages.add(ChatMessage(
      id: 'm${_nextId++}',
      role: ChatRole.user,
      text: trimmed,
      timestamp: DateTime.now(),
    ));
    _isResponding = true;
    notifyListeners();

    try {
      final reply = await _service.ask(trimmed);
      _messages.add(ChatMessage(
        id: 'm${_nextId++}',
        role: ChatRole.assistant,
        text: reply,
        timestamp: DateTime.now(),
      ));
    } catch (e) {
      _messages.add(ChatMessage(
        id: 'm${_nextId++}',
        role: ChatRole.assistant,
        text: e.toString(),
        timestamp: DateTime.now(),
      ));
    }
    _isResponding = false;
    notifyListeners();
  }
}

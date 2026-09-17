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
      // 2026-09-17 Final UX/Reliability task: this previously stored the raw
      // exception (`e.toString()`, e.g. "Exception: SocketException...") as
      // if it were the assistant's own reply - a genuinely broken-looking
      // first impression on any network/provider failure. `text` here is
      // never rendered for an error bubble (see `_MessageBubble` in
      // ai_ask_screen.dart, which substitutes the localized
      // `l10n.aiAskError` string whenever `isError` is true) - kept only so
      // a debugger/log inspecting `messages` can still see the real cause.
      _messages.add(ChatMessage(
        id: 'm${_nextId++}',
        role: ChatRole.assistant,
        text: e.toString(),
        timestamp: DateTime.now(),
        isError: true,
      ));
    }
    _isResponding = false;
    notifyListeners();
  }
}

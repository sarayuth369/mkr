import 'package:flutter/foundation.dart';

import '../../ai/domain/market_ai_service.dart';
import '../../billing/application/entitlement_controller.dart';
import '../domain/chat_message.dart';

/// 2026-09-19 Monetization Release 3 fix - AI Ask has a real per-request AI
/// provider cost (it proxies to a real backend/AI provider - see
/// MarketAIService's own doc comment), so it must never fire for a user
/// without the entitlement that unlocks it. Per the already-documented
/// product spec (see Entitlement.hasUnlimitedAI's own doc comment: "AI Pro
/// is the only tier with unlimited AI - Lifetime intentionally does NOT
/// include unlimited AI"), that entitlement is AI Pro specifically, not
/// "any paid tier" - Pro's own feature list has no AI features at all, so
/// broadening this to Pro/Lifetime would silently expand the documented
/// design rather than fix the reported Free-tier bypass.
///
/// This check lives here, in the application-layer controller whose
/// `send()` is the ONLY call site of `MarketAIService.ask()` in this app
/// (confirmed by grep - no widget calls the service directly), not only in
/// the screen's button/input enablement - so no future call path can reach
/// a real AI request while locked without this running first.
class AiAskController extends ChangeNotifier {
  AiAskController(this._service, this._entitlementController) {
    _entitlementController.addListener(_onEntitlementChanged);
  }

  final MarketAIService _service;
  final EntitlementController _entitlementController;
  int _nextId = 0;

  final List<ChatMessage> _messages = [];
  List<ChatMessage> get messages => List.unmodifiable(_messages);

  bool _isResponding = false;
  bool get isResponding => _isResponding;

  /// `true` until the viewer holds the AI Pro entitlement — reactive, so a
  /// purchase completed while this screen is open unlocks it immediately
  /// (see [_onEntitlementChanged]).
  bool get isLocked => !_entitlementController.entitlement.hasUnlimitedAI;

  void _onEntitlementChanged() => notifyListeners();

  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || _isResponding || isLocked) return;

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

  @override
  void dispose() {
    _entitlementController.removeListener(_onEntitlementChanged);
    super.dispose();
  }
}

import 'package:flutter/foundation.dart';

enum ChatRole { user, assistant }

@immutable
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.timestamp,
    this.isError = false,
  });

  final String id;
  final ChatRole role;
  final String text;
  final DateTime timestamp;

  /// True only for a locally-generated failure message (the AI call itself
  /// threw) - never for a real assistant reply. Lets the UI render it as a
  /// distinct "something went wrong" bubble instead of indistinguishable
  /// assistant prose, and keeps [text] a friendly, translated message
  /// rather than a raw exception string.
  final bool isError;
}

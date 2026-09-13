import 'package:flutter/foundation.dart';

enum NotificationDeliveryStatus { sent, failed }

@immutable
class NotificationHistoryEntry {
  const NotificationHistoryEntry({required this.title, required this.body, required this.sentAt, required this.status});

  final String title;
  final String body;
  final DateTime sentAt;
  final NotificationDeliveryStatus status;
}

/// Reads the lightweight notification history list (spec 2.3-K). Separate
/// from [PushNotificationService] (that's the transport that receives a
/// push right now; this is the persisted log of what was sent, regardless
/// of whether the app was open to receive it).
abstract class NotificationHistoryService {
  /// False when there is no backend to read from at all (Supabase not
  /// configured) - the UI must say so honestly rather than showing a
  /// permanently-empty list that looks the same as "you have no
  /// notifications yet".
  bool get isConfigured;

  Future<List<NotificationHistoryEntry>> getRecent();
}

class NoopNotificationHistoryService implements NotificationHistoryService {
  const NoopNotificationHistoryService();

  @override
  bool get isConfigured => false;

  @override
  Future<List<NotificationHistoryEntry>> getRecent() async => const [];
}

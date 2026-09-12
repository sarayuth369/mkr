import 'package:flutter/foundation.dart';

import '../domain/notification_service.dart';

class MockNotificationService implements NotificationService {
  final List<({String title, String body})> sent = [];

  @override
  Future<void> notify({required String title, required String body}) async {
    sent.add((title: title, body: body));
    debugPrint('[MKR mock notification] $title — $body');
  }
}

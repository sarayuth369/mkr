import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/push/data/firebase_push_notification_service.dart';

// [RemoteMessage]/[RemoteNotification] are plain constructible data classes
// from firebase_messaging_platform_interface — no platform channel/native
// Firebase runtime involved, so [toPushMessage]'s mapping logic is directly
// unit-testable even though the rest of FirebaseMessagingPushService (which
// calls real FirebaseMessaging.instance APIs) is not, without a real
// Android device/emulator — see MKR_FIREBASE_FCM_INTEGRATION_REPORT.md for
// exactly what remains manual/device-verified.
void main() {
  group('toPushMessage', () {
    test('maps a normal notification message (title, body, data)', () {
      const message = RemoteMessage(
        notification: RemoteNotification(title: 'AAPL alert', body: 'Crossed \$150'),
        data: {'symbol': 'AAPL', 'alertId': 'a1'},
      );

      final result = toPushMessage(message);

      expect(result.title, 'AAPL alert');
      expect(result.body, 'Crossed \$150');
      expect(result.data, {'symbol': 'AAPL', 'alertId': 'a1'});
    });

    test('a data-only message (no notification payload) maps to empty title/body, never null/crash', () {
      const message = RemoteMessage(data: {'type': 'silent-sync'});

      final result = toPushMessage(message);

      expect(result.title, '');
      expect(result.body, '');
      expect(result.data, {'type': 'silent-sync'});
    });

    test('a message with no data at all maps to an empty data map, never a fabricated one', () {
      const message = RemoteMessage(notification: RemoteNotification(title: 'Plain', body: 'No data'));

      final result = toPushMessage(message);

      expect(result.data, isEmpty);
    });
  });

  group('firebaseMessagingBackgroundHandler', () {
    test('completes without throwing for a normal message (never touches Supabase/history from the background isolate)', () async {
      const message = RemoteMessage(notification: RemoteNotification(title: 'Background', body: 'Test'));

      await expectLater(firebaseMessagingBackgroundHandler(message), completes);
    });
  });
}

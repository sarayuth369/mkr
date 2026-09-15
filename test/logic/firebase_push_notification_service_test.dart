import 'dart:async';

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

  // Firebase initialization failure-state fix - TwoPhaseInitGuard is a
  // small, Firebase-independent state machine, directly unit-testable with
  // plain fake phase1/phase2 callbacks - no platform channel/native
  // Firebase runtime involved, unlike FirebaseMessagingPushService.initialize()
  // itself (which wires real FirebaseMessaging calls into these same two
  // phases - see the class's own doc comment for the wiring).
  group('TwoPhaseInitGuard', () {
    test('A: a successful run invokes both phases exactly once; a repeated call after success is a no-op', () async {
      final guard = TwoPhaseInitGuard();
      var phase1Calls = 0;
      var phase2Calls = 0;
      Future<void> phase1() async => phase1Calls++;
      Future<void> phase2() async => phase2Calls++;

      await guard.run(phase1: phase1, phase2: phase2);

      expect(phase1Calls, 1);
      expect(phase2Calls, 1);
      expect(guard.hasSucceeded, true);

      await guard.run(phase1: phase1, phase2: phase2); // repeated call after success

      expect(phase1Calls, 1); // still 1 - no duplicate "listener" registration
      expect(phase2Calls, 1); // still 1 - correctly skipped once succeeded
    });

    test('B: a phase2 failure propagates and does NOT mark the guard succeeded', () async {
      final guard = TwoPhaseInitGuard();
      var phase1Calls = 0;
      Future<void> phase1() async => phase1Calls++;
      Future<void> failingPhase2() async => throw Exception('getInitialMessage failed');

      await expectLater(guard.run(phase1: phase1, phase2: failingPhase2), throwsException);

      expect(guard.hasSucceeded, false); // NOT permanently marked done - this is the exact bug being fixed
      expect(phase1Calls, 1);
    });

    test('C: a retry after failure succeeds without re-running phase1 ("listeners" stay attached exactly once)', () async {
      final guard = TwoPhaseInitGuard();
      var phase1Calls = 0;
      var phase2Attempts = 0;
      Future<void> phase1() async => phase1Calls++;
      Future<void> phase2() async {
        phase2Attempts++;
        if (phase2Attempts == 1) throw Exception('transient failure');
      }

      await expectLater(guard.run(phase1: phase1, phase2: phase2), throwsException); // first attempt fails
      expect(guard.hasSucceeded, false);

      await guard.run(phase1: phase1, phase2: phase2); // retry - succeeds this time

      expect(guard.hasSucceeded, true);
      expect(phase1Calls, 1); // STILL only 1 - phase1 (listener attachment) never re-ran on retry
      expect(phase2Attempts, 2); // phase2 WAS retried
    });

    test('D: concurrent callers share one in-flight attempt - phase1/phase2 each run exactly once', () async {
      final guard = TwoPhaseInitGuard();
      var phase1Calls = 0;
      var phase2Calls = 0;
      final phase2Started = Completer<void>(); // deterministic - signals the moment phase2 actually begins, no sleep
      final phase2Completer = Completer<void>(); // deterministic - the test controls exactly when phase2 resolves
      Future<void> phase1() async => phase1Calls++;
      Future<void> phase2() async {
        phase2Calls++;
        if (!phase2Started.isCompleted) phase2Started.complete();
        await phase2Completer.future;
      }

      final future1 = guard.run(phase1: phase1, phase2: phase2);
      final future2 = guard.run(phase1: phase1, phase2: phase2); // concurrent - issued before the first attempt resolves

      // Both run() calls above executed synchronously up to `await phase1()`
      // inside _runOnce (phase1 itself has no internal await, but `await`ing
      // it is still a genuine suspension point in Dart - control returns to
      // the caller before phase2 is ever reached). This already proves the
      // SECOND caller shared the first's in-flight attempt rather than
      // starting a competing one: `_inFlight ??= _runOnce(...)` short-circuits
      // on the second call, so a duplicate run would have shown up here as
      // phase1Calls == 2.
      expect(phase1Calls, 1);

      // Deterministically wait for phase2 to actually start (not a sleep -
      // this completer resolves the instant phase2() is entered) before
      // asserting on it, since reaching phase2 requires draining the
      // microtask that `await phase1()` scheduled.
      await phase2Started.future;
      expect(phase2Calls, 1); // exactly one phase2 invocation - the second caller did not start its own

      phase2Completer.complete();
      await future1;
      await future2;

      expect(guard.hasSucceeded, true);
      expect(phase1Calls, 1);
      expect(phase2Calls, 1);
    });
  });
}

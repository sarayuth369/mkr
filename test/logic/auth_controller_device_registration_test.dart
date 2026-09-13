import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/auth/application/auth_controller.dart';
import 'package:mkr/features/auth/domain/auth_service.dart';
import 'package:mkr/features/auth/domain/user_profile.dart';
import 'package:mkr/features/push/domain/device_repository.dart';
import 'package:mkr/features/push/domain/push_notification_service.dart';

class _FakeAuthService implements AuthService {
  UserProfile? nextLoginResult;

  @override
  Future<UserProfile?> currentSession() async => null;

  @override
  Future<UserProfile> continueAsGuest() async => const UserProfile(id: 'guest', email: '', isGuest: true);

  @override
  Future<UserProfile> login({required String email, required String password}) async => nextLoginResult!;

  @override
  Future<UserProfile> register({required String email, required String password}) async => nextLoginResult!;

  @override
  Future<void> logout() async {}
}

class _FakePushService implements PushNotificationService {
  bool permissionGranted = true;
  String? token = 'fake-fcm-token';
  int initializeCalls = 0;

  @override
  bool get isAvailable => true;

  @override
  Future<void> initialize() async => initializeCalls++;

  @override
  Future<bool> requestPermission() async => permissionGranted;

  @override
  Future<String?> getToken() async => token;

  @override
  Future<void> registerDevice() async {}

  @override
  Future<void> unregisterDevice() async {}

  @override
  Stream<PushMessage> get onForegroundMessage => const Stream.empty();

  @override
  Stream<PushMessage> get onNotificationTap => const Stream.empty();
}

class _FakeDeviceRepository implements DeviceRepository {
  String? registeredUserId;
  String? registeredToken;
  String? deactivatedToken;

  @override
  Future<void> registerDevice({required String userId, required String token, required String platform, required String appVersion}) async {
    registeredUserId = userId;
    registeredToken = token;
  }

  @override
  Future<void> deactivateDevice(String token) async {
    deactivatedToken = token;
  }
}

Future<void> pumpMicrotasks() => Future<void>.delayed(Duration.zero);

void main() {
  test('logging in as a real (non-guest) user registers the device once a push token is available', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-1', email: 'a@b.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    await controller.login('a@b.com', 'password');
    await pumpMicrotasks();

    expect(devices.registeredUserId, 'user-1');
    expect(devices.registeredToken, 'fake-fcm-token');
    expect(push.initializeCalls, 1);
  });

  test('a guest session never triggers device registration', () async {
    final auth = _FakeAuthService();
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
    expect(push.initializeCalls, 0);
  });

  test('denied notification permission never registers a device even if a token exists', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-2', email: 'c@d.com');
    final push = _FakePushService()..permissionGranted = false;
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();

    await controller.login('c@d.com', 'password');
    await pumpMicrotasks();

    expect(devices.registeredUserId, isNull);
  });

  test('logout deactivates the device token when one exists', () async {
    final auth = _FakeAuthService()..nextLoginResult = const UserProfile(id: 'user-3', email: 'e@f.com');
    final push = _FakePushService();
    final devices = _FakeDeviceRepository();
    final controller = AuthController(auth, pushService: push, deviceRepository: devices);
    await pumpMicrotasks();
    await controller.login('e@f.com', 'password');
    await pumpMicrotasks();

    await controller.logout();

    expect(devices.deactivatedToken, 'fake-fcm-token');
  });
}

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'app/app.dart';
import 'core/config/supabase_config.dart';
import 'core/deeplink/auth_callback.dart';
import 'core/deeplink/windows_uri_scheme_registrar.dart';
import 'core/persistence/app_local_store.dart';
import 'features/push/data/firebase_push_notification_service.dart';

/// Safe, idempotent Firebase Cloud Messaging bootstrap (MKR Firebase FCM
/// Integration Task). Android-only — `firebase_core` has no Windows/web
/// native implementation in this project, and this task's scope is
/// explicitly the Android client (see
/// docs/MKR-EXTERNAL-INTEGRATIONS.md#2-firebase-cloud-messaging-push-transport);
/// every non-Android build path is untouched, matching every other
/// backend-abstraction seam in this app (Supabase, market data) that
/// already fails gracefully rather than assumes availability.
///
/// A missing/misconfigured `google-services.json`, or no Firebase project
/// at all, must never crash startup — [FirebaseMessagingPushService] is
/// only ever constructed in app.dart when `Firebase.apps` ends up
/// non-empty; every other path keeps using [NoopPushNotificationService],
/// exactly like an unconfigured Supabase project already does.
Future<void> _initializeFirebase() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  if (Firebase.apps.isNotEmpty) return; // idempotent - e.g. a hot restart re-running main()
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {
    // No google-services.json / Firebase project not actually provisioned
    // yet - continue with push falling back to Noop (see app.dart).
  }
}

/// 2026-09-16 Closed Testing readiness task (material blocker gap): before
/// this, no global error handler existed anywhere in the app - an uncaught
/// exception in a Future/async callback outside a widget's own build method
/// (e.g. a fire-and-forget call not wrapped in try/catch somewhere deep in
/// the app) crashed the isolate with zero diagnostics, rather than
/// degrading gracefully the way every controller's own try/catch already
/// does for its own known async work. This does not add a crash-reporting
/// SDK (a new paid/infra dependency, out of this task's scope and not
/// something to introduce silently) - it only guarantees an uncaught error
/// is logged instead of taking the whole app down, matching the same
/// "degrade, don't crash" discipline already used throughout this codebase
/// (e.g. HomeController.refresh's per-phase try/catch).
void _installGlobalErrorHandlers() {
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    debugPrint('[MKR] Unhandled Flutter error: ${details.exceptionAsString()}');
  };
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    debugPrint('[MKR] Unhandled platform/async error: $error');
    return true; // handled - prevents this from crashing the isolate
  };
}

Future<void> main() async {
  _installGlobalErrorHandlers();
  runZonedGuarded(_mainInGuardedZone, (error, stack) {
    debugPrint('[MKR] Unhandled zone error: $error');
  });
}

Future<void> _mainInGuardedZone() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AppLocalStore.create();
  await _initializeFirebase();
  // Dev/test-machine registration only (Windows has no manifest-based
  // intent-filter equivalent) — no-op on every other platform. A packaged
  // production Windows distribution would register this via an MSIX
  // installer instead; see windows_uri_scheme_registrar.dart.
  await registerWindowsUriScheme(mkrAuthCallbackScheme);

  // Only initializes the client, never assumes a project exists — every
  // Supabase-backed repository/service checks SupabaseConfig.isConfigured
  // (or is only ever constructed behind that same check, see app.dart) and
  // falls back to local/mock behavior otherwise.
  if (SupabaseConfig.instance.isConfigured) {
    await sb.Supabase.initialize(url: SupabaseConfig.instance.url, publishableKey: SupabaseConfig.instance.anonKey);
  }

  runApp(MkrApp(store: store));
}

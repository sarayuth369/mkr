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

/// TEMPORARY diagnostic for the "Invalid API key" report — debug builds
/// only, never the actual key value. Remove once the runtime config is
/// confirmed correct on the reporter's machine.
void _debugPrintSupabaseConfig() {
  if (!kDebugMode) return;
  final config = SupabaseConfig.instance;
  final host = config.url.isEmpty ? '(empty)' : (Uri.tryParse(config.url)?.host ?? '(unparseable: check for stray quotes/spaces)');
  final keyLen = config.anonKey.length;
  final keyPrefix = config.anonKey.substring(0, keyLen < 20 ? keyLen : 20);
  debugPrint(
    '[MKR][supabase-diagnostic] host=$host isConfigured=${config.isConfigured} '
    'keyLen=$keyLen keyPrefix="$keyPrefix"',
  );
}

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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AppLocalStore.create();
  _debugPrintSupabaseConfig();
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

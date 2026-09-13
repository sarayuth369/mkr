import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'app/app.dart';
import 'core/config/supabase_config.dart';
import 'core/deeplink/auth_callback.dart';
import 'core/deeplink/windows_uri_scheme_registrar.dart';
import 'core/persistence/app_local_store.dart';

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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AppLocalStore.create();
  _debugPrintSupabaseConfig();
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

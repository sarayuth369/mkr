import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'app/app.dart';
import 'core/config/supabase_config.dart';
import 'core/persistence/app_local_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AppLocalStore.create();

  // Only initializes the client, never assumes a project exists — every
  // Supabase-backed repository/service checks SupabaseConfig.isConfigured
  // (or is only ever constructed behind that same check, see app.dart) and
  // falls back to local/mock behavior otherwise.
  if (SupabaseConfig.instance.isConfigured) {
    await sb.Supabase.initialize(url: SupabaseConfig.instance.url, publishableKey: SupabaseConfig.instance.anonKey);
  }

  runApp(MkrApp(store: store));
}

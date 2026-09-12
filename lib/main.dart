import 'package:flutter/material.dart';

import 'app/app.dart';
import 'core/persistence/app_local_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AppLocalStore.create();
  runApp(MkrApp(store: store));
}

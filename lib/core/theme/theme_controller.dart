import 'package:flutter/material.dart';

import '../persistence/app_local_store.dart';

class ThemeController extends ChangeNotifier {
  ThemeController(this._store) {
    final saved = _store.themeMode;
    _mode = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  final AppLocalStore _store;

  late ThemeMode _mode;
  ThemeMode get mode => _mode;

  Future<void> setMode(ThemeMode mode) async {
    _mode = mode;
    await _store.setThemeMode(mode.name);
    notifyListeners();
  }
}

import 'package:flutter/material.dart';

import '../persistence/app_local_store.dart';

class ThemeController extends ChangeNotifier {
  ThemeController(this._store) {
    final saved = _store.themeMode;
    _mode = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      'system' => ThemeMode.system,
      // Default (no saved preference yet, i.e. first run) is dark rather
      // than following the system setting - a deliberate product choice,
      // not a fallback. A user who has explicitly picked Light or System in
      // Settings keeps that choice untouched.
      _ => ThemeMode.dark,
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

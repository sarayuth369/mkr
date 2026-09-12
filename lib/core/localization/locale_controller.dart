import 'package:flutter/material.dart';

import '../persistence/app_local_store.dart';

class LocaleController extends ChangeNotifier {
  LocaleController(this._store) {
    final saved = _store.locale;
    _locale = (saved == null || saved == 'system') ? null : Locale(saved);
  }

  final AppLocalStore _store;

  Locale? _locale;
  Locale? get locale => _locale;

  Future<void> setLocale(Locale? locale) async {
    _locale = locale;
    await _store.setLocale(locale?.languageCode ?? 'system');
    notifyListeners();
  }
}

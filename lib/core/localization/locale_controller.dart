import 'package:flutter/material.dart';

import '../persistence/app_local_store.dart';

/// MKR is a global product: English is the default and primary language
/// regardless of device locale. Thai is available only when the user
/// explicitly picks it in Settings — this controller never falls back to
/// the device's system locale, so a Thai-language phone does not silently
/// switch the app to Thai.
class LocaleController extends ChangeNotifier {
  LocaleController(this._store) {
    final saved = _store.locale;
    _locale = saved == 'th' ? const Locale('th') : const Locale('en');
  }

  final AppLocalStore _store;

  static const supported = [Locale('en'), Locale('th')];

  late Locale _locale;
  Locale get locale => _locale;

  Future<void> setLocale(Locale locale) async {
    _locale = locale;
    await _store.setLocale(locale.languageCode);
    notifyListeners();
  }
}

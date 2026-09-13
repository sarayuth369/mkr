import 'dart:io';

import 'package:win32_registry/win32_registry.dart';

/// Dev-only Windows custom-URI-scheme registration for `mkr://` deep links
/// (Supabase email confirmation callback). Windows has no manifest-based
/// intent-filter equivalent — `app_links` requires the app to register its
/// own protocol handler under `HKEY_CURRENT_USER\Software\Classes\<scheme>`
/// pointing at the current executable, per the official app_links Windows
/// setup (https://github.com/llfbandit/app_links/blob/main/doc/README_windows.md,
/// "for un-packaged apps or manual setup" — exactly this project's dev/test
/// use case; a packaged production distribution would use an MSIX installer
/// instead, which registers this declaratively).
///
/// Idempotent and safe to call on every launch — always overwrites the same
/// two values with the current `Platform.resolvedExecutable` path, so a
/// rebuilt binary (new path/hash) keeps the association current.
Future<void> registerWindowsUriScheme(String scheme) async {
  if (!Platform.isWindows) return;

  final appPath = Platform.resolvedExecutable;
  final root = RegistryKey.openCurrentUser(RegistryAccess.readWrite);
  try {
    final schemeKey = root.create('Software\\Classes\\$scheme');
    try {
      schemeKey.setValue('URL Protocol', const RegistryValue.string(''));
      final commandKey = schemeKey.create('shell\\open\\command');
      try {
        commandKey.setValue('', RegistryValue.string('"$appPath" "%1"'));
      } finally {
        commandKey.close();
      }
    } finally {
      schemeKey.close();
    }
  } finally {
    root.close();
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/constants/disclaimer.dart';
import '../../../../core/constants/legal_text.dart';
import '../../../../core/localization/locale_controller.dart';
import '../../../../core/persistence/app_local_store.dart';
import '../../../../core/theme/theme_controller.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/presentation/premium_tier_label.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import 'static_text_screen.dart';

const String appVersion = '1.0.0 (Phase 1)';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final auth = context.watch<AuthController>();
    final entitlement = context.watch<EntitlementController>().entitlement;
    final themeController = context.watch<ThemeController>();
    final localeController = context.watch<LocaleController>();
    final store = context.read<AppLocalStore>();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.account_circle_outlined),
            title: Text(l10n.settingsAccount),
            subtitle: Text(auth.profile?.isGuest == true ? l10n.settingsAccountGuest : auth.profile?.email ?? ''),
            trailing: auth.profile?.isGuest == true
                ? FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const LoginScreen()),
                    ),
                    child: Text(l10n.authLogin),
                  )
                : TextButton(
                    onPressed: auth.logout,
                    child: Text(l10n.authLogout),
                  ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: Text(l10n.settingsSubscription),
            subtitle: Text('${l10n.premiumCurrentPlan}: ${premiumTierLabel(l10n, entitlement.tier)}'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.restore_outlined),
            title: Text(l10n.settingsRestorePurchases),
            onTap: () async {
              await context.read<EntitlementController>().restore();
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(l10n.purchasesRestoredMessage)));
              }
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.brightness_6_outlined),
            title: Text(l10n.settingsAppearance),
            trailing: DropdownButton<ThemeMode>(
              value: themeController.mode,
              underline: const SizedBox.shrink(),
              items: [
                DropdownMenuItem(value: ThemeMode.system, child: Text(l10n.settingsThemeSystem)),
                DropdownMenuItem(value: ThemeMode.light, child: Text(l10n.settingsThemeLight)),
                DropdownMenuItem(value: ThemeMode.dark, child: Text(l10n.settingsThemeDark)),
              ],
              onChanged: (mode) => mode == null ? null : themeController.setMode(mode),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.language_outlined),
            title: Text(l10n.settingsLanguage),
            // Language names are shown in their own endonym (English / ไทย)
            // regardless of the active app locale — standard practice for a
            // language picker, not a hard-coded Thai UI string.
            trailing: DropdownButton<Locale>(
              value: localeController.locale,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: Locale('en'), child: Text('English')),
                DropdownMenuItem(value: Locale('th'), child: Text('ไทย')),
              ],
              onChanged: (value) => value == null ? null : localeController.setLocale(value),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.attach_money_outlined),
            title: Text(l10n.settingsCurrency),
            trailing: DropdownButton<String>(
              value: store.currency,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: 'USD', child: Text('USD')),
                DropdownMenuItem(value: 'THB', child: Text('THB')),
              ],
              onChanged: (value) => value == null ? null : store.setCurrency(value),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: Text(l10n.settingsNotifications),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.tune_outlined),
            title: Text(l10n.settingsMarketPreferences),
            onTap: () {},
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: Text(l10n.settingsPrivacyPolicy),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => StaticTextScreen(title: l10n.settingsPrivacyPolicy, body: LegalText.privacyPolicy),
            )),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(l10n.settingsTerms),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => StaticTextScreen(title: l10n.settingsTerms, body: LegalText.termsOfService),
            )),
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.settingsAbout),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => StaticTextScreen(
                title: l10n.settingsAbout,
                body: '${LegalText.aboutMkr}\n\n${Disclaimer.full}\n\n${l10n.settingsAppVersion}: $appVersion',
              ),
            )),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text('${l10n.settingsAppVersion}: $appVersion', style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ),
        ],
      ),
    );
  }
}

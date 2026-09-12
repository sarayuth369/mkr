import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/constants/disclaimer.dart';
import '../../../../core/constants/legal_text.dart';
import '../../../../core/localization/locale_controller.dart';
import '../../../../core/persistence/app_local_store.dart';
import '../../../../core/theme/theme_controller.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import 'static_text_screen.dart';

const String appVersion = '1.0.0 (Phase 1)';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final entitlement = context.watch<EntitlementController>().entitlement;
    final themeController = context.watch<ThemeController>();
    final localeController = context.watch<LocaleController>();
    final store = context.read<AppLocalStore>();

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.account_circle_outlined),
            title: const Text('Account'),
            subtitle: Text(auth.profile?.isGuest == true ? 'Guest' : auth.profile?.email ?? ''),
            trailing: auth.profile?.isGuest == true
                ? FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const LoginScreen()),
                    ),
                    child: const Text('Log in'),
                  )
                : TextButton(
                    onPressed: auth.logout,
                    child: const Text('Log out'),
                  ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: const Text('Subscription'),
            subtitle: Text('Current: ${entitlement.tier.label}'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.restore_outlined),
            title: const Text('Restore Purchases'),
            onTap: () async {
              await context.read<EntitlementController>().restore();
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(const SnackBar(content: Text('Purchases restored')));
              }
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.brightness_6_outlined),
            title: const Text('Appearance'),
            trailing: DropdownButton<ThemeMode>(
              value: themeController.mode,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: ThemeMode.system, child: Text('System')),
                DropdownMenuItem(value: ThemeMode.light, child: Text('Light')),
                DropdownMenuItem(value: ThemeMode.dark, child: Text('Dark')),
              ],
              onChanged: (mode) => mode == null ? null : themeController.setMode(mode),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.language_outlined),
            title: const Text('Language'),
            trailing: DropdownButton<Locale?>(
              value: localeController.locale,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: null, child: Text('System')),
                DropdownMenuItem(value: Locale('en'), child: Text('English')),
                DropdownMenuItem(value: Locale('th'), child: Text('ไทย')),
              ],
              onChanged: localeController.setLocale,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.attach_money_outlined),
            title: const Text('Currency'),
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
            title: const Text('Notifications'),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.tune_outlined),
            title: const Text('Market preferences'),
            onTap: () {},
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Privacy Policy'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => const StaticTextScreen(title: 'Privacy Policy', body: LegalText.privacyPolicy),
            )),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: const Text('Terms of Service'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => const StaticTextScreen(title: 'Terms of Service', body: LegalText.termsOfService),
            )),
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('About MKR'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => const StaticTextScreen(
                title: 'About MKR',
                body: '${LegalText.aboutMkr}\n\n${Disclaimer.full}\n\nApp version: $appVersion',
              ),
            )),
          ),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('App version: $appVersion', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ),
        ],
      ),
    );
  }
}

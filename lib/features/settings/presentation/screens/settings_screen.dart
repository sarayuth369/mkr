import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/localization/locale_controller.dart';
import '../../../../core/persistence/app_local_store.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/theme_controller.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/premium_tier_label.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import 'about_screen.dart';
import 'static_text_screen.dart';

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
          _SectionHeader(l10n.settingsSectionAccount),
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
          _SectionHeader(l10n.settingsSectionSubscription),
          _SubscriptionCard(entitlement: entitlement),
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
          _SectionHeader(l10n.settingsSectionPreferences),
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
          _SectionHeader(l10n.settingsSectionNotifications),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: Text(l10n.settingsNotifications),
            onTap: () {},
          ),
          _SectionHeader(l10n.settingsSectionMarket),
          ListTile(
            leading: const Icon(Icons.tune_outlined),
            title: Text(l10n.settingsMarketPreferences),
            onTap: () {},
          ),
          _SectionHeader(l10n.settingsSectionLegal),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: Text(l10n.settingsPrivacyPolicy),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => StaticTextScreen(title: l10n.settingsPrivacyPolicy, body: l10n.privacyPolicyBody),
            )),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(l10n.settingsTerms),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => StaticTextScreen(title: l10n.settingsTerms, body: l10n.termsOfServiceBody),
            )),
          ),
          _SectionHeader(l10n.settingsSectionAbout),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.settingsAbout),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AboutScreen())),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              '${l10n.versionLabel} ${AboutScreen.appVersion}',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
      child: Text(
        label,
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.primary,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

/// The strongest conversion point in Settings — a prominent card rather
/// than a passive row, wording driven entirely by current entitlement.
class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({required this.entitlement});

  final Entitlement entitlement;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final isFree = entitlement.tier == PremiumTier.free;

    final onGradient = Colors.white;
    final premiumAccent = context.marketColors.premiumAccent;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Card(
        clipBehavior: Clip.antiAlias,
        color: isFree ? null : theme.colorScheme.surfaceContainerHigh,
        child: Container(
          decoration: isFree
              ? BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [premiumAccent, theme.colorScheme.primary],
                  ),
                )
              : null,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen())),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    Icons.workspace_premium,
                    color: isFree ? onGradient : theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isFree ? l10n.settingsUnlockPro : premiumTierLabel(l10n, entitlement.tier),
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: isFree ? onGradient : null,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isFree ? l10n.settingsUnlockProSubtitle : l10n.settingsActive,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: isFree ? onGradient.withValues(alpha: 0.9) : context.marketColors.gain,
                            fontWeight: isFree ? null : FontWeight.w700,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    isFree ? l10n.settingsViewPlans : l10n.settingsManagePlan,
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: isFree ? onGradient : theme.colorScheme.primary,
                    ),
                  ),
                  Icon(Icons.chevron_right, color: isFree ? onGradient : theme.colorScheme.primary),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

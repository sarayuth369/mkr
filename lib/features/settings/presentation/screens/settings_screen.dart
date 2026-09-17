import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/localization/locale_controller.dart';
import '../../../../core/persistence/app_local_store.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/theme_controller.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../alerts/application/alerts_controller.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/presentation/screens/login_screen.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/premium_tier_label.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../../push/presentation/screens/notification_history_screen.dart';
import '../../../watchlist/application/watchlist_controller.dart';
import 'about_screen.dart';
import 'static_text_screen.dart';

/// 2026-09-17 Hosted Privacy Policy task - the real, public policy page,
/// served by the same deployed Worker every other MKR network call
/// already uses (`market_data_config.dart`'s `_backendUrlDefine` default),
/// not a new domain/service.
const _hostedPrivacyPolicyUrl = 'https://mkr-backend.biz2success.workers.dev/privacy';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  /// Opens the real hosted policy in the device's browser. Falls back to
  /// the existing in-app static text (unchanged, still fully localized)
  /// only if the URL genuinely cannot be launched (e.g. no browser
  /// available) - never leaves the user with neither.
  Future<void> _openPrivacyPolicy(BuildContext context, AppLocalizations l10n) async {
    final uri = Uri.parse(_hostedPrivacyPolicyUrl);
    bool opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened && context.mounted) {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => StaticTextScreen(title: l10n.settingsPrivacyPolicy, body: l10n.privacyPolicyBody),
      ));
    }
  }

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
                    onPressed: () => _handleLogout(context, auth),
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
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationHistoryScreen())),
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
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _openPrivacyPolicy(context, l10n),
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

/// Refreshes the watchlist/alerts lists right after logout so the UI
/// immediately reflects the fresh (empty, until the new guest/user's own
/// data loads) state rather than briefly still showing the just-logged-out
/// account's list — [AuthService.logout] already clears the underlying
/// local cache (see [AppLocalStore.clearUserScopedCache]), this just makes
/// the already-built in-memory controllers pick that up right away instead
/// of waiting for their next unrelated rebuild.
Future<void> _handleLogout(BuildContext context, AuthController auth) async {
  await auth.logout();
  if (!context.mounted) return;
  await context.read<WatchlistController>().refresh();
  if (!context.mounted) return;
  await context.read<AlertsController>().refresh();
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

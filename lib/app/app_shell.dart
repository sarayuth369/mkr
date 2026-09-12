import 'package:flutter/material.dart';

import '../features/alerts/presentation/screens/alerts_screen.dart';
import '../features/home/presentation/screens/home_screen.dart';
import '../features/markets/presentation/screens/markets_screen.dart';
import '../features/settings/presentation/screens/settings_screen.dart';
import '../features/watchlist/presentation/screens/watchlist_screen.dart';
import '../l10n/generated/app_localizations.dart';

/// Root bottom-navigation shell: Home / Markets / Watchlist / Alerts /
/// Settings, per the main navigation spec. Tabs keep state via IndexedStack.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  static const _screens = [
    HomeScreen(),
    MarketsScreen(),
    WatchlistScreen(),
    AlertsScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: IndexedStack(index: _index, children: _screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: l10n.navHome),
          NavigationDestination(icon: const Icon(Icons.show_chart_outlined), selectedIcon: const Icon(Icons.show_chart), label: l10n.navMarkets),
          NavigationDestination(icon: const Icon(Icons.star_border), selectedIcon: const Icon(Icons.star), label: l10n.navWatchlist),
          NavigationDestination(icon: const Icon(Icons.notifications_none), selectedIcon: const Icon(Icons.notifications), label: l10n.navAlerts),
          NavigationDestination(icon: const Icon(Icons.settings_outlined), selectedIcon: const Icon(Icons.settings), label: l10n.navSettings),
        ],
      ),
    );
  }
}

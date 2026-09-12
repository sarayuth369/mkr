import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/market_quote.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../../markets/presentation/screens/market_detail_screen.dart';
import '../../application/watchlist_controller.dart';

class WatchlistScreen extends StatelessWidget {
  const WatchlistScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<WatchlistController>();
    final entitlement = context.watch<EntitlementController>().entitlement;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.watchlistTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: l10n.watchlistAddSymbolTooltip,
            onPressed: () => _showAddSymbolSheet(context, controller, entitlement),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: controller.state.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(16),
            child: LoadingSkeletonList(rows: 5),
          ),
          error: (message) => ErrorState(message: message, onRetry: controller.refresh),
          empty: () => ListView(
            children: [
              EmptyState(
                message: '${l10n.watchlistEmpty}. ${l10n.watchlistAddSome}.',
                icon: Icons.star_border,
                actionLabel: l10n.watchlistAddSymbolTooltip,
                onAction: () => _showAddSymbolSheet(context, controller, entitlement),
              ),
            ],
          ),
          success: (quotes, isStale, lastUpdated) {
            // A free account can end up with more saved symbols than its
            // current limit allows (e.g. the seeded default watchlist).
            // Never show a contradictory "6 / 3" style count — clamp the
            // displayed "active" count to the limit and render the rest as
            // locked preview rows instead of just silently listing them all
            // as if they were fully usable.
            final activeCount = entitlement.hasUnlimitedWatchlist
                ? quotes.length
                : quotes.length.clamp(0, Entitlement.freeWatchlistLimit);
            final isOverLimit = !entitlement.hasUnlimitedWatchlist && quotes.length > activeCount;

            return Column(
              children: [
                if (!entitlement.hasUnlimitedWatchlist && quotes.isNotEmpty)
                  _LimitBanner(
                    message: l10n.watchlistLimitReached(activeCount, Entitlement.freeWatchlistLimit),
                    onUpgrade: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen())),
                  ),
                Expanded(
                  child: ReorderableListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: quotes.length,
                    // ignore: deprecated_member_use
                    onReorder: controller.reorder,
                    itemBuilder: (context, index) {
                      final quote = quotes[index];
                      final isLocked = isOverLimit && index >= activeCount;
                      return Dismissible(
                        key: ValueKey(quote.symbol),
                        direction: DismissDirection.endToStart,
                        onDismissed: (_) => controller.remove(quote.symbol),
                        background: Container(
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          color: Theme.of(context).colorScheme.errorContainer,
                          child: const Icon(Icons.delete_outline),
                        ),
                        child: isLocked
                            ? Opacity(
                                opacity: 0.5,
                                child: AssetRow(
                                  quote: quote,
                                  trailing: Icon(Icons.lock_outline, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen())),
                                ),
                              )
                            : AssetRow(
                                quote: quote,
                                sparkline: MockMarketCatalog.syntheticSeries(quote.symbol, points: 10),
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => MarketDetailScreen(symbol: quote.symbol)),
                                ),
                              ),
                      );
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  void _showAddSymbolSheet(
    BuildContext context,
    WatchlistController controller,
    Entitlement entitlement,
  ) {
    if (!entitlement.hasUnlimitedWatchlist &&
        controller.symbols.length >= Entitlement.freeWatchlistLimit) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen()));
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _AddSymbolSheet(controller: controller),
    );
  }
}

class _LimitBanner extends StatelessWidget {
  const _LimitBanner({required this.message, required this.onUpgrade});

  final String message;
  final VoidCallback onUpgrade;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.workspace_premium_outlined, size: 16, color: theme.colorScheme.onPrimaryContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onPrimaryContainer),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          TextButton(onPressed: onUpgrade, child: Text(l10n.premiumUpgrade)),
        ],
      ),
    );
  }
}

class _AddSymbolSheet extends StatefulWidget {
  const _AddSymbolSheet({required this.controller});

  final WatchlistController controller;

  @override
  State<_AddSymbolSheet> createState() => _AddSymbolSheetState();
}

class _AddSymbolSheetState extends State<_AddSymbolSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final results = MockMarketCatalog.search(_query)
        .where((q) => !widget.controller.contains(q.symbol))
        .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              autofocus: true,
              decoration: InputDecoration(
                hintText: l10n.searchSymbolHint,
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: ListView.builder(
                controller: scrollController,
                itemCount: results.length,
                itemBuilder: (context, index) {
                  final MarketQuote quote = results[index];
                  return AssetRow(
                    quote: quote,
                    onTap: () {
                      widget.controller.add(quote.symbol);
                      Navigator.pop(context);
                    },
                    trailing: const Icon(Icons.add_circle_outline),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

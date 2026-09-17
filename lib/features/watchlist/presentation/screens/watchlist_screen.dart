import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../domain/market_quote.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/domain/entitlement.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../../markets/domain/market_fetch_result.dart';
import '../../../markets/domain/market_service.dart';
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
                    // 2026-09-17 Final UX/Reliability task: matches the
                    // `all(16)` content-padding convention every other main
                    // list screen uses (Markets/Home/Detail/Calendar/News).
                    padding: const EdgeInsets.all(16),
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

/// 2026-09-15 hardening task: searches the real [MarketService] (the same
/// canonical catalog + typed fetch result every other market surface uses)
/// instead of [MockMarketCatalog] directly - in real mode this now shows
/// only symbols the backend currently has enabled, with real live quotes,
/// never a frozen mock price. [MockMarketService] still answers this in
/// demo mode via the SAME `MarketService.search` call, so demo mode is
/// unaffected.
class _AddSymbolSheetState extends State<_AddSymbolSheet> {
  late final MarketService _marketService = context.read<MarketService>();
  Timer? _debounce;
  String _query = '';
  bool _loading = false;
  String? _error;
  List<MarketQuote> _results = const [];

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    setState(() => _query = value);
    _debounce?.cancel();
    if (value.trim().isEmpty) {
      setState(() {
        _results = const [];
        _loading = false;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () => _runSearch(value));
  }

  Future<void> _runSearch(String query) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await _marketService.search(query);
      if (!mounted || query != _query) return; // a newer query has already superseded this one
      setState(() {
        _loading = false;
        _results = result.quotes;
        _error = result is MarketFetchFailure ? result.message : null;
      });
    } catch (e) {
      if (!mounted || query != _query) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final results = _results.where((q) => !widget.controller.contains(q.symbol)).toList();

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
              onChanged: _onQueryChanged,
            ),
            const SizedBox(height: 12),
            if (_loading) const Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())
            else if (_error != null)
              Expanded(child: ErrorState(message: _error!, onRetry: () => _runSearch(_query)))
            else if (_query.trim().isEmpty)
              Expanded(child: EmptyState(message: l10n.searchSymbolHint, icon: Icons.search))
            else if (results.isEmpty)
              Expanded(child: EmptyState(message: l10n.marketsNoSymbolsMatch, icon: Icons.search_off))
            else
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

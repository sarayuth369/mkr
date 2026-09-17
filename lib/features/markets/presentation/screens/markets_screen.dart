import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_data_status_chip.dart';
import '../../../../domain/asset_class.dart';
import '../../../../domain/market_data_mode.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/mkr_ad_slot.dart';
import '../../application/markets_controller.dart';
import 'market_detail_screen.dart';

class MarketsScreen extends StatefulWidget {
  const MarketsScreen({super.key});

  @override
  State<MarketsScreen> createState() => _MarketsScreenState();
}

class _MarketsScreenState extends State<MarketsScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  // 2026-09-17 Catalog Expansion task: Indices and Thailand chips removed.
  // Live verification against the real Twelve Data account confirmed
  // every symbol in both categories is unsupported on the current plan
  // (Grow/Venture-gated indices; Thai XBKK equities gated the same way) -
  // every row was disabled rather than left enabled for appearance (see
  // schema.sql), which left both categories with zero enabled symbols.
  // A chip that always resolves to the empty state is worse than no chip;
  // if either provider capability is ever added, restore the chip here
  // alongside re-enabling the relevant rows.
  List<MapEntry<String, AssetClass?>> _categories(AppLocalizations l10n) => [
        MapEntry(l10n.filterAll, null),
        MapEntry(l10n.categoryGold, AssetClass.gold),
        MapEntry(l10n.categoryUsStocks, AssetClass.usStock),
        MapEntry(l10n.categoryCrypto, AssetClass.crypto),
        MapEntry(l10n.categoryForex, AssetClass.forex),
      ];

  @override
  void initState() {
    super.initState();
    // 2026-09-17 Catalog Expansion task: triggers MarketsController.loadMore
    // only when the list is genuinely near its end - never on every scroll
    // frame, never a burst of calls (loadMore itself is a no-op while
    // already loading or with nothing left to fetch, so a few redundant
    // near-bottom frames before the first page lands cost nothing extra).
    _scrollController.addListener(() {
      if (!_scrollController.hasClients) return;
      final position = _scrollController.position;
      if (position.pixels >= position.maxScrollExtent - 200) {
        context.read<MarketsController>().loadMore();
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<MarketsController>();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.marketsTitle)),
      body: MkrAdBody(
        child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: MarketDataStatusChip(mode: controller.mode.effectiveFor(controller.state), lastUpdated: controller.lastUpdated),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: l10n.searchSymbolHint,
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: controller.setQuery,
            ),
          ),
          SizedBox(
            // Headroom above ChoiceChip's natural height at 1.0x text scale,
            // so the app-wide text-scale clamp (see MaterialApp's builder in
            // app.dart) never pushes a chip past this fixed height.
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final entry in _categories(l10n))
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Center(
                      child: ChoiceChip(
                        label: Text(entry.key),
                        selected: controller.category == entry.value,
                        onSelected: (_) => controller.setCategory(entry.value),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: controller.state.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(16),
                  child: LoadingSkeletonList(rows: 6),
                ),
                error: (message) => ErrorState(message: message, onRetry: controller.refresh),
                empty: () => EmptyState(message: l10n.marketsNoMarketsAvailable, icon: Icons.show_chart),
                success: (_, __, ___) {
                  final quotes = controller.visibleQuotes();
                  if (quotes.isEmpty) {
                    return EmptyState(message: l10n.marketsNoSymbolsMatch, icon: Icons.search_off);
                  }
                  return Column(
                    children: [
                      // Non-blocking degraded indicator (task: "render the
                      // valid symbols and expose a non-blocking degraded/
                      // error indication rather than hiding all successful
                      // data") - shown alongside the real data, never in
                      // place of it.
                      if (controller.state.isPartial) _PartialDataBanner(message: l10n.marketsPartialData),
                      Expanded(
                        child: ListView.builder(
                          controller: _scrollController,
                          // 2026-09-16 post-phone Closed Testing correction
                          // task: this list sits directly above the fixed
                          // MkrBottomBannerAd (bottomNavigationBar already
                          // reserves that separate space, so nothing is
                          // literally hidden behind it - but with zero
                          // bottom padding here, the last row's bottom edge
                          // touched the ad's top edge with no breathing
                          // room at all, unlike every sibling screen using
                          // this same ad slot pattern (Home/News/Calendar/
                          // Market Detail all already use `all(16)`,
                          // matched here on the bottom edge).
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                          // 2026-09-17 Catalog Expansion task: one extra
                          // trailing row for the load-more indicator when
                          // this view genuinely has more catalog matches
                          // than have been fetched yet - never rendered
                          // once every match in the current filter is
                          // resolved or confirmed unavailable.
                          itemCount: quotes.length + (controller.hasMore ? 1 : 0),
                          itemBuilder: (context, index) {
                            if (index >= quotes.length) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: 16),
                                child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
                              );
                            }
                            final quote = quotes[index];
                            return AssetRow(
                              quote: quote,
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => MarketDetailScreen(symbol: quote.symbol)),
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
          ),
        ],
        ),
      ),
      bottomNavigationBar: const MkrBottomBannerAd(),
    );
  }
}

class _PartialDataBanner extends StatelessWidget {
  const _PartialDataBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, size: 16, color: theme.colorScheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onErrorContainer),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

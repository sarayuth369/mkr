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

  List<MapEntry<String, AssetClass?>> _categories(AppLocalizations l10n) => [
        MapEntry(l10n.filterAll, null),
        MapEntry(l10n.categoryGold, AssetClass.gold),
        MapEntry(l10n.categoryUsStocks, AssetClass.usStock),
        MapEntry(l10n.categoryIndices, AssetClass.indices),
        MapEntry(l10n.categoryCrypto, AssetClass.crypto),
        MapEntry(l10n.categoryForex, AssetClass.forex),
        MapEntry(l10n.categoryThailand, AssetClass.thailand),
      ];

  @override
  void dispose() {
    _searchController.dispose();
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
                          itemCount: quotes.length,
                          itemBuilder: (context, index) {
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

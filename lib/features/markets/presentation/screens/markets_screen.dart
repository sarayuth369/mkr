import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/market_data_status_chip.dart';
import '../../../../data/mock_market_catalog.dart';
import '../../../../domain/asset_class.dart';
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
            child: MarketDataStatusChip(mode: controller.mode, lastUpdated: controller.lastUpdated),
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
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final entry in _categories(l10n))
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(entry.key),
                      selected: controller.category == entry.value,
                      onSelected: (_) => controller.setCategory(entry.value),
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
                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: quotes.length,
                    itemBuilder: (context, index) {
                      final quote = quotes[index];
                      return AssetRow(
                        quote: quote,
                        sparkline: MockMarketCatalog.syntheticSeries(quote.symbol, points: 10),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => MarketDetailScreen(symbol: quote.symbol)),
                        ),
                      );
                    },
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

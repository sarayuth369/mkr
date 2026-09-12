import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/asset_row.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../domain/asset_class.dart';
import '../../application/markets_controller.dart';
import 'market_detail_screen.dart';

class MarketsScreen extends StatefulWidget {
  const MarketsScreen({super.key});

  @override
  State<MarketsScreen> createState() => _MarketsScreenState();
}

class _MarketsScreenState extends State<MarketsScreen> {
  final _searchController = TextEditingController();

  static const _categories = <String, AssetClass?>{
    'All': null,
    'Gold': AssetClass.gold,
    'US Stocks': AssetClass.usStock,
    'Indices': AssetClass.indices,
    'Crypto': AssetClass.crypto,
    'Forex': AssetClass.forex,
    'Thailand': AssetClass.thailand,
  };

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<MarketsController>();

    return Scaffold(
      appBar: AppBar(title: const Text('Markets')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: const InputDecoration(
                hintText: 'Search symbol or name',
                prefixIcon: Icon(Icons.search),
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
                for (final entry in _categories.entries)
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
                empty: () => const EmptyState(message: 'No markets available', icon: Icons.show_chart),
                success: (_, __, ___) {
                  final quotes = controller.visibleQuotes();
                  if (quotes.isEmpty) {
                    return const EmptyState(message: 'No symbols match your search', icon: Icons.search_off);
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
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
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

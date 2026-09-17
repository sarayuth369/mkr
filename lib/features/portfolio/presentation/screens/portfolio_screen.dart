import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../domain/market_symbol_info.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/presentation/widgets/premium_gate.dart';
import '../../../markets/domain/market_service.dart';
import '../../application/portfolio_controller.dart';
import '../../domain/portfolio_calculations.dart';
import '../../domain/portfolio_holding.dart';

class PortfolioScreen extends StatelessWidget {
  const PortfolioScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final entitlement = context.watch<EntitlementController>().entitlement;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.portfolioTitle),
        actions: [
          if (entitlement.hasPortfolio)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: l10n.portfolioAddHolding,
              onPressed: () => _showAddHoldingSheet(context),
            ),
        ],
      ),
      body: PremiumGate(
        isUnlocked: entitlement.hasPortfolio,
        featureName: l10n.portfolioTitle,
        child: const _PortfolioBody(),
      ),
    );
  }

  void _showAddHoldingSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => const _AddHoldingSheet(),
    );
  }
}

class _PortfolioBody extends StatelessWidget {
  const _PortfolioBody();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<PortfolioController>();

    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: controller.state.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingSkeletonList(rows: 4)),
        error: (message) => ErrorState(message: message, onRetry: controller.refresh),
        empty: () => ListView(
          children: [
            EmptyState(
              message: '${l10n.portfolioEmpty}. ${l10n.portfolioEmptyHint}',
              icon: Icons.pie_chart_outline,
            ),
          ],
        ),
        success: (summary, isStale, lastUpdated) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Non-blocking degraded indicator, never hiding the valid
            // cost-basis-priced data underneath (2026-09-15 FINAL FINAL
            // correction task, Defect 1).
            if (controller.state.isPartial) _PartialDataBanner(message: l10n.portfolioPartialData),
            _SummaryCard(summary: summary),
            const SizedBox(height: 20),
            if (summary.lines.isNotEmpty) _AllocationChart(summary: summary),
            const SizedBox(height: 20),
            Text(l10n.portfolioHoldingsSectionTitle, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            for (final line in summary.lines)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  // 2026-09-17 Final UX/Reliability task: previously bare
                  // `TextStyle`s bypassing the theme entirely - the one
                  // divergence on a screen that is otherwise disciplined
                  // about `theme.textTheme` (see `_SummaryCard`/
                  // `_AllocationChart` above), and the most visible
                  // content on the screen since it's the main holdings list.
                  title: Text(line.holding.symbol, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  subtitle: Text('${line.holding.quantity} @ ${Formatters.price(line.holding.avgPrice)}'),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(Formatters.price(line.marketValue)),
                      Text(
                        '${Formatters.changeAbs(line.totalPL)} (${line.totalPLPct.toStringAsFixed(1)}%)',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: line.totalPL >= 0 ? context.marketColors.gain : context.marketColors.loss,
                            ),
                      ),
                    ],
                  ),
                  onLongPress: () => controller.removeHolding(line.holding.symbol),
                ),
              ),
          ],
        ),
      ),
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
      margin: const EdgeInsets.only(bottom: 12),
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

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary});

  final PortfolioSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final marketColors = context.marketColors;
    final plColor = summary.totalPL >= 0 ? marketColors.gain : marketColors.loss;
    final dailyColor = summary.dailyPL >= 0 ? marketColors.gain : marketColors.loss;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.portfolioTotalValue, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            Text(Formatters.price(summary.totalValue), style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _stat(theme, l10n.portfolioDailyPl, Formatters.changeAbs(summary.dailyPL), dailyColor),
                ),
                Expanded(
                  child: _stat(
                    theme,
                    l10n.portfolioTotalPl,
                    '${Formatters.changeAbs(summary.totalPL)} (${summary.totalPLPct.toStringAsFixed(1)}%)',
                    plColor,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(ThemeData theme, String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        Text(value, style: theme.textTheme.titleSmall?.copyWith(color: color, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

class _AllocationChart extends StatelessWidget {
  const _AllocationChart({required this.summary});

  final PortfolioSummary summary;

  static const _palette = [
    Color(0xFF1857A4),
    Color(0xFF3DDC97),
    Color(0xFFE0B341),
    Color(0xFFD1373F),
    Color(0xFF9C6ADE),
    Color(0xFF4CC9F0),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final allocation = summary.allocationBySymbol();
    final entries = allocation.entries.toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.portfolioAllocation, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            SizedBox(
              height: 160,
              child: Row(
                children: [
                  Expanded(
                    child: PieChart(
                      PieChartData(
                        sectionsSpace: 2,
                        centerSpaceRadius: 30,
                        sections: [
                          for (var i = 0; i < entries.length; i++)
                            PieChartSectionData(
                              value: entries[i].value * 100,
                              color: _palette[i % _palette.length],
                              title: '',
                              radius: 50,
                            ),
                        ],
                      ),
                    ),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        for (var i = 0; i < entries.length; i++)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              children: [
                                Container(width: 10, height: 10, color: _palette[i % _palette.length]),
                                const SizedBox(width: 6),
                                Text('${entries[i].key} ${(entries[i].value * 100).toStringAsFixed(0)}%',
                                    style: Theme.of(context).textTheme.labelSmall),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddHoldingSheet extends StatefulWidget {
  const _AddHoldingSheet();

  @override
  State<_AddHoldingSheet> createState() => _AddHoldingSheetState();
}

/// 2026-09-16 Final Full-System One-Pass audit finding: mirrors the same
/// fix applied to CreateAlertScreen's symbol picker - real mode previously
/// read [MockMarketCatalog] unconditionally here too, so a holding could
/// only ever be added for a symbol on the static mock list, never a real
/// backend-enabled one outside it. Now sourced from the real
/// [MarketService.getCatalog] (metadata only, zero provider cost),
/// mode-aware the same way every other real-mode-aware picker in this app
/// is (see `_AddSymbolSheet` in watchlist_screen.dart).
class _AddHoldingSheetState extends State<_AddHoldingSheet> {
  late final MarketService _marketService = context.read<MarketService>();
  String? _symbol;
  final _quantityController = TextEditingController();
  final _avgPriceController = TextEditingController();

  List<MarketSymbolInfo>? _catalog;
  String? _catalogError;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    try {
      final catalog = await _marketService.getCatalog();
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _catalogError = null;
        _symbol ??= catalog.isNotEmpty ? catalog.first.symbol : null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _catalogError = e.toString());
    }
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _avgPriceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final catalog = _catalog;

    if (catalog == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: _catalogError != null
            ? ErrorState(message: _catalogError!, onRetry: _loadCatalog)
            : const Center(child: CircularProgressIndicator()),
      );
    }

    final symbol = (_symbol != null && catalog.any((c) => c.symbol == _symbol)) ? _symbol! : (catalog.isNotEmpty ? catalog.first.symbol : null);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.portfolioAddHolding, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          if (catalog.isEmpty)
            Text(l10n.marketsNoSymbolsMatch)
          else
            DropdownButtonFormField<String>(
              initialValue: symbol,
              decoration: InputDecoration(labelText: l10n.portfolioSymbol),
              items: [
                for (final q in catalog)
                  DropdownMenuItem(value: q.symbol, child: Text('${q.symbol} — ${q.displayName}')),
              ],
              onChanged: (v) => setState(() => _symbol = v ?? _symbol),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _quantityController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: l10n.portfolioQuantity),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _avgPriceController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: l10n.portfolioAvgPrice),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: symbol == null
                ? null
                : () {
                    final quantity = double.tryParse(_quantityController.text);
                    final avgPrice = double.tryParse(_avgPriceController.text);
                    if (quantity == null || avgPrice == null || quantity <= 0 || avgPrice <= 0) return;
                    context.read<PortfolioController>().addHolding(
                          PortfolioHolding(symbol: symbol, quantity: quantity, avgPrice: avgPrice),
                        );
                    Navigator.pop(context);
                  },
            child: Text(l10n.save),
          ),
        ],
      ),
    );
  }
}

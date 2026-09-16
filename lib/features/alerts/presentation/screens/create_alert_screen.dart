import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/alert_card.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../domain/market_symbol_info.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../../markets/domain/market_service.dart';
import '../../application/alerts_controller.dart';
import '../../domain/alert.dart';

class CreateAlertScreen extends StatefulWidget {
  const CreateAlertScreen({super.key, this.initialSymbol});

  final String? initialSymbol;

  @override
  State<CreateAlertScreen> createState() => _CreateAlertScreenState();
}

/// 2026-09-16 Final Full-System One-Pass audit finding: the symbol picker
/// previously read [MockMarketCatalog] unconditionally, even in real mode -
/// a symbol the backend doesn't currently support could be selected (the
/// alert then silently never fires, since [AlertsController]'s evaluation
/// only resolves catalog-authorized symbols), a real symbol the backend DOES
/// support but that isn't in the static mock list couldn't be chosen at all,
/// and a real, backend-sourced `initialSymbol` (from Market Detail) not
/// present in the fixed mock list could crash `DropdownButtonFormField`
/// (`initialValue` absent from `items`). Now sources the picker from the
/// real [MarketService.getCatalog] (metadata only, zero provider cost) -
/// the same real-vs-demo-mode-aware call every other real-mode-aware screen
/// uses (see `_AddSymbolSheet` in watchlist_screen.dart for the established
/// pattern), so demo mode is unaffected (MockMarketService answers the same
/// call from MockMarketCatalog itself).
class _CreateAlertScreenState extends State<CreateAlertScreen> {
  late final MarketService _marketService = context.read<MarketService>();
  AlertType _type = AlertType.price;
  String? _symbol;
  PriceDirection _direction = PriceDirection.above;
  final _priceController = TextEditingController();
  final _percentageController = TextEditingController(text: '5');
  final _eventKeywordController = TextEditingController(text: 'CPI');
  RadarTransition _transition = RadarTransition.neutralToBullish;

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
        _symbol = widget.initialSymbol ?? (catalog.isNotEmpty ? catalog.first.symbol : null);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _catalogError = e.toString());
    }
  }

  @override
  void dispose() {
    _priceController.dispose();
    _percentageController.dispose();
    _eventKeywordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final entitlement = context.watch<EntitlementController>().entitlement;
    final catalog = _catalog;

    if (catalog == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.createAlert)),
        body: _catalogError != null
            ? ErrorState(message: _catalogError!, onRetry: _loadCatalog)
            : const Center(child: CircularProgressIndicator()),
      );
    }

    // A backend-sourced initialSymbol not present in the current catalog
    // (e.g. a symbol disabled between viewing Detail and opening this
    // screen) falls back to the first catalog entry rather than handing
    // the dropdown a value absent from its own items.
    final symbol = (_symbol != null && catalog.any((c) => c.symbol == _symbol)) ? _symbol! : (catalog.isNotEmpty ? catalog.first.symbol : null);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.createAlert)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final type in AlertType.values)
                ChoiceChip(
                  label: Text(alertTypeLabel(l10n, type).toUpperCase()),
                  selected: _type == type,
                  onSelected: (_) {
                    final needsAdvanced = type == AlertType.event || type == AlertType.radar;
                    if (needsAdvanced && !entitlement.hasAdvancedAlerts) {
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaywallScreen()));
                      return;
                    }
                    setState(() => _type = type);
                  },
                ),
            ],
          ),
          const SizedBox(height: 20),
          if (_type == AlertType.price || _type == AlertType.percentage || _type == AlertType.radar)
            if (catalog.isEmpty)
              Text(l10n.marketsNoSymbolsMatch)
            else
              _SymbolPicker(
                value: symbol!,
                catalog: catalog,
                label: l10n.portfolioSymbol,
                onChanged: (value) => setState(() => _symbol = value),
              ),
          const SizedBox(height: 16),
          if (_type == AlertType.price) ...[
            SegmentedButton<PriceDirection>(
              segments: [
                ButtonSegment(value: PriceDirection.above, label: Text(l10n.priceDirectionAbove), icon: const Icon(Icons.arrow_upward)),
                ButtonSegment(value: PriceDirection.below, label: Text(l10n.priceDirectionBelow), icon: const Icon(Icons.arrow_downward)),
              ],
              selected: {_direction},
              onSelectionChanged: (s) => setState(() => _direction = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _priceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l10n.targetPriceLabel),
            ),
          ],
          if (_type == AlertType.percentage)
            TextField(
              controller: _percentageController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l10n.percentageThresholdLabel),
            ),
          if (_type == AlertType.event)
            TextField(
              controller: _eventKeywordController,
              decoration: InputDecoration(labelText: l10n.eventKeywordLabel),
            ),
          if (_type == AlertType.radar)
            DropdownButtonFormField<RadarTransition>(
              initialValue: _transition,
              decoration: InputDecoration(labelText: l10n.radarTransitionFieldLabel),
              items: [
                for (final t in RadarTransition.values)
                  DropdownMenuItem(value: t, child: Text(radarTransitionLabel(l10n, t))),
              ],
              onChanged: (value) => setState(() => _transition = value ?? _transition),
            ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _save, child: Text(l10n.save)),
        ],
      ),
    );
  }

  void _save() {
    final catalog = _catalog ?? const <MarketSymbolInfo>[];
    final symbol = (_symbol != null && catalog.any((c) => c.symbol == _symbol)) ? _symbol! : (catalog.isNotEmpty ? catalog.first.symbol : '');
    final id = DateTime.now().microsecondsSinceEpoch.toString();
    final alert = switch (_type) {
      AlertType.price => Alert.price(
          id: id,
          symbol: symbol,
          target: double.tryParse(_priceController.text) ?? 0,
          direction: _direction,
        ),
      AlertType.percentage => Alert.percentage(
          id: id,
          symbol: symbol,
          thresholdPct: double.tryParse(_percentageController.text) ?? 5,
        ),
      AlertType.event => Alert.event(id: id, eventKeyword: _eventKeywordController.text),
      AlertType.radar => Alert.radar(id: id, symbol: symbol, transition: _transition),
    };
    context.read<AlertsController>().addAlert(alert);
    Navigator.of(context).pop();
  }
}

class _SymbolPicker extends StatelessWidget {
  const _SymbolPicker({required this.value, required this.catalog, required this.label, required this.onChanged});

  final String value;
  final List<MarketSymbolInfo> catalog;
  final String label;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final q in catalog)
          DropdownMenuItem(value: q.symbol, child: Text('${q.symbol} — ${q.displayName}')),
      ],
      onChanged: (v) => v == null ? null : onChanged(v),
    );
  }
}

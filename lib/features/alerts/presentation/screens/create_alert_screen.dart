import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../data/mock_market_catalog.dart';
import '../../../billing/application/entitlement_controller.dart';
import '../../../billing/presentation/screens/paywall_screen.dart';
import '../../application/alerts_controller.dart';
import '../../domain/alert.dart';

class CreateAlertScreen extends StatefulWidget {
  const CreateAlertScreen({super.key, this.initialSymbol});

  final String? initialSymbol;

  @override
  State<CreateAlertScreen> createState() => _CreateAlertScreenState();
}

class _CreateAlertScreenState extends State<CreateAlertScreen> {
  AlertType _type = AlertType.price;
  late String _symbol = widget.initialSymbol ?? MockMarketCatalog.all.first.symbol;
  PriceDirection _direction = PriceDirection.above;
  final _priceController = TextEditingController();
  final _percentageController = TextEditingController(text: '5');
  final _eventKeywordController = TextEditingController(text: 'CPI');
  RadarTransition _transition = RadarTransition.neutralToBullish;

  @override
  void dispose() {
    _priceController.dispose();
    _percentageController.dispose();
    _eventKeywordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entitlement = context.watch<EntitlementController>().entitlement;

    return Scaffold(
      appBar: AppBar(title: const Text('Create Alert')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final type in AlertType.values)
                ChoiceChip(
                  label: Text(type.name.toUpperCase()),
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
            _SymbolPicker(
              value: _symbol,
              onChanged: (value) => setState(() => _symbol = value),
            ),
          const SizedBox(height: 16),
          if (_type == AlertType.price) ...[
            SegmentedButton<PriceDirection>(
              segments: const [
                ButtonSegment(value: PriceDirection.above, label: Text('Above'), icon: Icon(Icons.arrow_upward)),
                ButtonSegment(value: PriceDirection.below, label: Text('Below'), icon: Icon(Icons.arrow_downward)),
              ],
              selected: {_direction},
              onSelectionChanged: (s) => setState(() => _direction = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _priceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Target price'),
            ),
          ],
          if (_type == AlertType.percentage)
            TextField(
              controller: _percentageController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Percentage threshold (±%)'),
            ),
          if (_type == AlertType.event)
            TextField(
              controller: _eventKeywordController,
              decoration: const InputDecoration(labelText: 'Event keyword (e.g. CPI, FOMC, NFP, Fed Speech)'),
            ),
          if (_type == AlertType.radar)
            DropdownButtonFormField<RadarTransition>(
              initialValue: _transition,
              decoration: const InputDecoration(labelText: 'Radar transition'),
              items: [
                for (final t in RadarTransition.values) DropdownMenuItem(value: t, child: Text(t.label)),
              ],
              onChanged: (value) => setState(() => _transition = value ?? _transition),
            ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _save, child: const Text('Save')),
        ],
      ),
    );
  }

  void _save() {
    final id = DateTime.now().microsecondsSinceEpoch.toString();
    final alert = switch (_type) {
      AlertType.price => Alert.price(
          id: id,
          symbol: _symbol,
          target: double.tryParse(_priceController.text) ?? 0,
          direction: _direction,
        ),
      AlertType.percentage => Alert.percentage(
          id: id,
          symbol: _symbol,
          thresholdPct: double.tryParse(_percentageController.text) ?? 5,
        ),
      AlertType.event => Alert.event(id: id, eventKeyword: _eventKeywordController.text),
      AlertType.radar => Alert.radar(id: id, symbol: _symbol, transition: _transition),
    };
    context.read<AlertsController>().addAlert(alert);
    Navigator.of(context).pop();
  }
}

class _SymbolPicker extends StatelessWidget {
  const _SymbolPicker({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: const InputDecoration(labelText: 'Symbol'),
      items: [
        for (final q in MockMarketCatalog.all)
          DropdownMenuItem(value: q.symbol, child: Text('${q.symbol} — ${q.name}')),
      ],
      onChanged: (v) => v == null ? null : onChanged(v),
    );
  }
}

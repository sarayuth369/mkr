import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';

/// A simple Bullish/Bearish split bar computed transparently from the
/// quote's own [changePct] — a disclosed function of real price action, not
/// an invented external sentiment signal. Deliberately not shown anywhere
/// the data can't back it (Market Detail only).
class MarketSentimentGauge extends StatelessWidget {
  const MarketSentimentGauge({super.key, required this.changePct});

  final double changePct;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final colors = context.marketColors;

    final bullish = (50 + changePct.clamp(-8, 8) * 5).clamp(5, 95).round();
    final bearish = 100 - bullish;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.marketDetailSentiment,
          style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Row(
            children: [
              Expanded(flex: bullish, child: Container(height: 8, color: colors.gain)),
              Expanded(flex: bearish, child: Container(height: 8, color: colors.loss)),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('${l10n.marketDetailBullish} $bullish%', style: TextStyle(color: colors.gain, fontSize: 11, fontWeight: FontWeight.w700)),
            Text('${l10n.marketDetailBearish} $bearish%', style: TextStyle(color: colors.loss, fontSize: 11, fontWeight: FontWeight.w700)),
          ],
        ),
      ],
    );
  }
}

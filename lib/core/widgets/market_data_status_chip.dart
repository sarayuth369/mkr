import 'package:flutter/material.dart';

import '../../domain/market_data_mode.dart';
import '../../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// Small "where did this data come from" indicator — a colored dot, a
/// LIVE/DEMO DATA/STALE/OFFLINE label, and a relative "Updated Xs ago"
/// timestamp. Never claims LIVE unless [mode] genuinely is.
class MarketDataStatusChip extends StatelessWidget {
  const MarketDataStatusChip({super.key, required this.mode, this.lastUpdated});

  final MarketDataMode mode;
  final DateTime? lastUpdated;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = context.marketColors;

    final (color, label) = switch (mode) {
      MarketDataMode.live => (colors.live, l10n.dataModeLive),
      MarketDataMode.demo => (colors.demo, l10n.dataModeDemo),
      MarketDataMode.stale => (colors.stale, l10n.dataModeStale),
      MarketDataMode.connecting => (colors.stale, l10n.dataModeConnecting),
      MarketDataMode.providerError => (colors.offline, l10n.dataModeProviderError),
      MarketDataMode.offline => (colors.offline, l10n.dataModeOffline),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
        ),
        if (lastUpdated != null) ...[
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              l10n.updatedRelative(Formatters.relative(lastUpdated!)),
              style: theme.textTheme.labelSmall,
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
        ],
      ],
    );
  }
}

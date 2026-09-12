import 'package:flutter/material.dart';

import '../../domain/market_quote.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';
import 'sparkline.dart';

/// One-line compact row for a symbol — used in Market list, Watchlist,
/// search results and Portfolio holdings.
class AssetRow extends StatelessWidget {
  const AssetRow({
    super.key,
    required this.quote,
    this.onTap,
    this.trailing,
    this.subtitle,
    this.sparkline,
  });

  final MarketQuote quote;
  final VoidCallback? onTap;
  final Widget? trailing;
  final String? subtitle;

  /// Optional trend line rendered between the name and the price columns.
  /// Left `null` (the default) everywhere a call site doesn't opt in, so
  /// existing rows are visually unchanged.
  final List<double>? sparkline;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final marketColors = context.marketColors;
    final changeColor = quote.isUp ? marketColors.gain : marketColors.loss;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    quote.symbol,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    subtitle ?? quote.name,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (trailing == null && sparkline != null && sparkline!.length > 1) ...[
              Sparkline(values: sparkline!, color: changeColor, width: 48, height: 24),
              const SizedBox(width: 12),
            ],
            if (trailing != null)
              trailing!
            else
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    Formatters.price(quote.price),
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    Formatters.changePct(quote.changePct),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: changeColor,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

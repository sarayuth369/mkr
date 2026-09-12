import 'package:flutter/material.dart';

import '../../domain/market_quote.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// One-line compact row for a symbol — used in Market list, Watchlist,
/// search results and Portfolio holdings.
class AssetRow extends StatelessWidget {
  const AssetRow({
    super.key,
    required this.quote,
    this.onTap,
    this.trailing,
    this.subtitle,
  });

  final MarketQuote quote;
  final VoidCallback? onTap;
  final Widget? trailing;
  final String? subtitle;

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
                  Text(quote.symbol, style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  )),
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
            if (trailing != null)
              trailing!
            else
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    Formatters.price(quote.price),
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    Formatters.changePct(quote.changePct),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: changeColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

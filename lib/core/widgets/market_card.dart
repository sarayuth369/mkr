import 'package:flutter/material.dart';

import '../../domain/market_quote.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// Compact chip-style card for the Home "Market Status" row — symbol, price,
/// percentage change, status color at a glance.
class MarketCard extends StatelessWidget {
  const MarketCard({super.key, required this.quote, this.label, this.onTap});

  final MarketQuote quote;
  final String? label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final marketColors = context.marketColors;
    final changeColor = quote.isUp ? marketColors.gain : marketColors.loss;

    return SizedBox(
      width: 132,
      child: Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label ?? quote.symbol,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Text(
                  Formatters.price(quote.price),
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Icon(
                      quote.isUp ? Icons.arrow_drop_up : Icons.arrow_drop_down,
                      color: changeColor,
                      size: 18,
                    ),
                    Flexible(
                      child: Text(
                        Formatters.changePct(quote.changePct),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: changeColor,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

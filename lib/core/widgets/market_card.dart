import 'package:flutter/material.dart';

import '../../domain/market_quote.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';
import 'sparkline.dart';

/// Compact card for a single symbol — used in Home's "Market Pulse" row and
/// wherever a tappable price tile is needed. Set [featured] for the larger
/// hero-card treatment and pass [sparkline] to show a tiny trend line.
class MarketCard extends StatefulWidget {
  const MarketCard({
    super.key,
    required this.quote,
    this.label,
    this.onTap,
    this.sparkline,
    this.featured = false,
  });

  final MarketQuote quote;
  final String? label;
  final VoidCallback? onTap;
  final List<double>? sparkline;
  final bool featured;

  @override
  State<MarketCard> createState() => _MarketCardState();
}

class _MarketCardState extends State<MarketCard> {
  double? _previousPrice;
  Color? _flashColor;

  @override
  void didUpdateWidget(covariant MarketCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.quote.price != widget.quote.price) {
      _previousPrice = oldWidget.quote.price;
      final marketColors = context.marketColors;
      setState(() {
        _flashColor = widget.quote.price >= _previousPrice!
            ? marketColors.gain.withValues(alpha: 0.14)
            : marketColors.loss.withValues(alpha: 0.14);
      });
      Future.delayed(const Duration(milliseconds: 700), () {
        if (mounted) setState(() => _flashColor = null);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final marketColors = context.marketColors;
    final quote = widget.quote;
    final changeColor = quote.isUp ? marketColors.gain : marketColors.loss;
    final width = widget.featured ? 156.0 : 132.0;

    return SizedBox(
      width: width,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          borderRadius: BorderRadius.circular(16),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            color: _flashColor ?? Colors.transparent,
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  widget.label ?? quote.symbol,
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
                  mainAxisSize: MainAxisSize.min,
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
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                if (widget.sparkline != null && widget.sparkline!.length > 1) ...[
                  const SizedBox(height: 6),
                  Sparkline(values: widget.sparkline!, color: changeColor, width: width - 24),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../utils/formatters.dart';

/// Horizontal low→high range track with a marker at the current price.
/// Pure presentation over data the quote already carries — no invented
/// numbers.
class DayRangeBar extends StatelessWidget {
  const DayRangeBar({super.key, required this.label, required this.low, required this.high, required this.value});

  final String label;
  final double low;
  final double high;
  final double value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final range = (high - low).abs() < 1e-9 ? 1.0 : high - low;
    final fraction = ((value - low) / range).clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 6),
        LayoutBuilder(
          builder: (context, constraints) {
            final trackWidth = constraints.maxWidth;
            final markerX = (fraction * trackWidth).clamp(6.0, trackWidth - 6.0);
            return SizedBox(
              height: 16,
              child: Stack(
                alignment: Alignment.centerLeft,
                children: [
                  Container(
                    height: 4,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Positioned(
                    left: markerX - 6,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        shape: BoxShape.circle,
                        border: Border.all(color: theme.colorScheme.surface, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(Formatters.price(low), style: theme.textTheme.labelSmall),
            Text(Formatters.price(high), style: theme.textTheme.labelSmall),
          ],
        ),
      ],
    );
  }
}

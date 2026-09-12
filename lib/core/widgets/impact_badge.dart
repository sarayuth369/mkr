import 'package:flutter/material.dart';

import '../../domain/impact_level.dart';
import '../theme/app_theme.dart';

class ImpactBadge extends StatelessWidget {
  const ImpactBadge({super.key, required this.impact, this.dense = false});

  final ImpactLevel impact;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.marketColors;
    final color = switch (impact) {
      ImpactLevel.high => colors.impactHigh,
      ImpactLevel.medium => colors.impactMedium,
      ImpactLevel.low => colors.impactLow,
    };
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 6 : 10,
        vertical: dense ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        impact.label,
        style: TextStyle(
          color: color,
          fontSize: dense ? 10 : 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

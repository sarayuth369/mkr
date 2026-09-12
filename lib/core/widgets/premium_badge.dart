import 'package:flutter/material.dart';

import '../../features/billing/domain/entitlement.dart';

class PremiumBadge extends StatelessWidget {
  const PremiumBadge({super.key, required this.tier});

  final PremiumTier tier;

  @override
  Widget build(BuildContext context) {
    if (tier == PremiumTier.free) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [theme.colorScheme.tertiary, theme.colorScheme.primary],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.workspace_premium, size: 14, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            tier.label,
            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

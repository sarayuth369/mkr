import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../billing/application/entitlement_controller.dart';
import '../../domain/ad_service.dart';

/// Drop this anywhere a banner ad may appear. Renders nothing at all for
/// ad-free (paid) users.
class AdBannerSlot extends StatelessWidget {
  const AdBannerSlot({super.key});

  @override
  Widget build(BuildContext context) {
    final isAdFree = context.watch<EntitlementController>().entitlement.isAdFree;
    if (isAdFree) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: context.read<AdService>().buildBanner(context),
    );
  }
}

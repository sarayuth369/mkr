import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../billing/application/entitlement_controller.dart';
import '../../domain/ad_config.dart';
import '../../domain/ads_eligibility.dart';
import '../../domain/ad_service.dart';

// Reusable TOP AD / CONTENT / BOTTOM AD shell — the one place ad
// placement/visibility logic lives, so no screen re-implements it.
//
// Usage on any screen:
//   Scaffold(
//     appBar: AppBar(...),
//     body: MkrAdBody(child: existingBody),
//     bottomNavigationBar: const MkrBottomBannerAd(),
//   )
// For a screen that already has its own bottomNavigationBar (there are none
// today — AppShell owns the single real one), compose a Column of
// [MkrBottomBannerAd(), thatNavBar] instead.

bool _shouldShowSlot(BuildContext context, {required bool slotEnabled}) {
  final config = context.read<AdConfig>();
  final isPremium = context.watch<EntitlementController>().entitlement.isAdFree;
  return AdsEligibility.shouldShowAds(adsEnabled: config.enabled, isPremium: isPremium) && slotEnabled;
}

/// Wraps a page's scrollable content with a reserved top-ad area above it.
/// Collapses to zero height automatically when the top banner is disabled
/// or the viewer is ad-free — never a layout jump once an ad "arrives",
/// since the placeholder/real ad occupies the same fixed banner height from
/// the first frame.
class MkrAdBody extends StatelessWidget {
  const MkrAdBody({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const MkrTopBannerAd(),
        Expanded(child: child),
      ],
    );
  }
}

/// Reserved top banner slot. Never overlays the AppBar/title/search/filters
/// — it is laid out as its own row above the page content, not a stacked
/// overlay, so it can't cover anything.
class MkrTopBannerAd extends StatelessWidget {
  const MkrTopBannerAd({super.key});

  @override
  Widget build(BuildContext context) {
    final config = context.read<AdConfig>();
    if (!_shouldShowSlot(context, slotEnabled: config.topBannerEnabled)) return const SizedBox.shrink();
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        child: context.read<AdService>().buildBanner(context),
      ),
    );
  }
}

/// Fixed bottom banner slot — pass as a screen's `bottomNavigationBar` so it
/// never scrolls away with the content and never overlaps [AppShell]'s
/// bottom navigation (a nested [Scaffold]'s `bottomNavigationBar` stacks
/// correctly above an ancestor Scaffold's own, giving exactly
/// `content / bottom ad / bottom nav` without any manual height math or
/// extra ListView padding).
class MkrBottomBannerAd extends StatelessWidget {
  const MkrBottomBannerAd({super.key});

  @override
  Widget build(BuildContext context) {
    final config = context.read<AdConfig>();
    if (!_shouldShowSlot(context, slotEnabled: config.bottomBannerEnabled)) return const SizedBox.shrink();
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
        child: context.read<AdService>().buildBanner(context),
      ),
    );
  }
}

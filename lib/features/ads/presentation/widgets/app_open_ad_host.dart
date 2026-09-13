import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../billing/application/entitlement_controller.dart';
import '../../application/app_open_ad_manager.dart';

/// Wraps the app's main content (below [MaterialApp], so its context has a
/// [Navigator] to show the ad dialog against) and drives [AppOpenAdManager]
/// on cold start and on every foreground/resume — the manager's own
/// frequency-cap policy decides whether an ad actually appears, so this
/// host never needs its own throttling logic.
class AppOpenAdHost extends StatefulWidget {
  const AppOpenAdHost({super.key, required this.child});

  final Widget child;

  @override
  State<AppOpenAdHost> createState() => _AppOpenAdHostState();
}

class _AppOpenAdHostState extends State<AppOpenAdHost> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _tryShow());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _tryShow() async {
    if (!mounted) return;
    final isPremium = context.read<EntitlementController>().entitlement.isAdFree;
    await context.read<AppOpenAdManager>().onAppForeground(context, isPremium: isPremium);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_tryShow());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

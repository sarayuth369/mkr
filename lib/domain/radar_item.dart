import 'package:flutter/foundation.dart';

import 'impact_level.dart';

/// A single "thing to watch today" entry shown on Home's Today's Radar.
@immutable
class RadarItem {
  const RadarItem({
    required this.title,
    required this.time,
    required this.impact,
    this.subtitle,
  });

  final String title;
  final DateTime time;
  final ImpactLevel impact;
  final String? subtitle;
}

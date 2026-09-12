import 'package:flutter/foundation.dart';

import '../../../domain/impact_level.dart';

@immutable
class EconomicEvent {
  const EconomicEvent({
    required this.id,
    required this.dateTime,
    required this.country,
    required this.title,
    required this.impact,
    this.previous,
    this.forecast,
    this.actual,
  });

  final String id;
  final DateTime dateTime;
  final String country;
  final String title;
  final ImpactLevel impact;
  final String? previous;
  final String? forecast;
  final String? actual;
}

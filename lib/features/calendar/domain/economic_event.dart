import 'package:flutter/foundation.dart';

import '../../../domain/impact_level.dart';

/// Status: scheduled, released, cancelled, unknown - see the backend's
/// canonical EconomicEvent model (backend/src/calendar/types.ts).
enum EconomicEventStatus { scheduled, released, cancelled, unknown }

@immutable
class EconomicEvent {
  const EconomicEvent({
    required this.id,
    required this.dateTime,
    required this.country,
    required this.title,
    required this.impact,
    this.currency,
    this.category,
    this.previous,
    this.forecast,
    this.actual,
    this.status = EconomicEventStatus.unknown,
    this.relatedAssets = const [],
    this.sourceUrl,
  });

  final String id;
  final DateTime dateTime;
  final String country;
  final String? currency;
  final String title;
  /// MKR-owned classification (e.g. "monetary_policy", "inflation") - never a copied commercial-provider label.
  final String? category;
  final ImpactLevel impact;
  final String? previous;
  final String? forecast;
  final String? actual;
  final EconomicEventStatus status;
  /// MKR internal symbols this event is relevant to - metadata only, never a trading signal.
  final List<String> relatedAssets;
  final String? sourceUrl;
}

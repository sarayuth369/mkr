import 'package:flutter/foundation.dart';

enum AlertType { price, percentage, event, radar }

enum PriceDirection { above, below }

enum RadarTransition { neutralToBullish, neutralToBearish, bullishToNeutral, bearishToNeutral }

extension RadarTransitionX on RadarTransition {
  String get label => switch (this) {
        RadarTransition.neutralToBullish => 'Neutral → Bullish',
        RadarTransition.neutralToBearish => 'Neutral → Bearish',
        RadarTransition.bullishToNeutral => 'Bullish → Neutral',
        RadarTransition.bearishToNeutral => 'Bearish → Neutral',
      };
}

/// One alert. Fields are grouped by [type] — only the fields relevant to
/// that type are populated, enforced by the factory constructors below and
/// by the create-alert UI which branches its form per type.
@immutable
class Alert {
  const Alert({
    required this.id,
    required this.type,
    required this.symbol,
    required this.isEnabled,
    required this.createdAt,
    this.priceTarget,
    this.priceDirection,
    this.percentageThreshold,
    this.eventKeyword,
    this.radarTransition,
    this.lastTriggeredAt,
  });

  factory Alert.price({
    required String id,
    required String symbol,
    required double target,
    required PriceDirection direction,
  }) {
    return Alert(
      id: id,
      type: AlertType.price,
      symbol: symbol,
      isEnabled: true,
      createdAt: DateTime.now(),
      priceTarget: target,
      priceDirection: direction,
    );
  }

  factory Alert.percentage({
    required String id,
    required String symbol,
    required double thresholdPct,
  }) {
    return Alert(
      id: id,
      type: AlertType.percentage,
      symbol: symbol,
      isEnabled: true,
      createdAt: DateTime.now(),
      percentageThreshold: thresholdPct,
    );
  }

  factory Alert.event({
    required String id,
    required String eventKeyword,
  }) {
    return Alert(
      id: id,
      type: AlertType.event,
      symbol: eventKeyword,
      isEnabled: true,
      createdAt: DateTime.now(),
      eventKeyword: eventKeyword,
    );
  }

  factory Alert.radar({
    required String id,
    required String symbol,
    required RadarTransition transition,
  }) {
    return Alert(
      id: id,
      type: AlertType.radar,
      symbol: symbol,
      isEnabled: true,
      createdAt: DateTime.now(),
      radarTransition: transition,
    );
  }

  final String id;
  final AlertType type;
  final String symbol;
  final bool isEnabled;
  final DateTime createdAt;
  final double? priceTarget;
  final PriceDirection? priceDirection;
  final double? percentageThreshold;
  final String? eventKeyword;
  final RadarTransition? radarTransition;
  final DateTime? lastTriggeredAt;

  String get summary => switch (type) {
        AlertType.price =>
          '$symbol ${priceDirection == PriceDirection.above ? '>' : '<'} ${priceTarget?.toStringAsFixed(2)}',
        AlertType.percentage => '$symbol ±${percentageThreshold?.toStringAsFixed(1)}%',
        AlertType.event => 'Event: $eventKeyword',
        AlertType.radar => '$symbol ${radarTransition?.label}',
      };

  Alert copyWith({bool? isEnabled, DateTime? lastTriggeredAt}) {
    return Alert(
      id: id,
      type: type,
      symbol: symbol,
      isEnabled: isEnabled ?? this.isEnabled,
      createdAt: createdAt,
      priceTarget: priceTarget,
      priceDirection: priceDirection,
      percentageThreshold: percentageThreshold,
      eventKeyword: eventKeyword,
      radarTransition: radarTransition,
      lastTriggeredAt: lastTriggeredAt ?? this.lastTriggeredAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'symbol': symbol,
        'isEnabled': isEnabled,
        'createdAt': createdAt.toIso8601String(),
        'priceTarget': priceTarget,
        'priceDirection': priceDirection?.name,
        'percentageThreshold': percentageThreshold,
        'eventKeyword': eventKeyword,
        'radarTransition': radarTransition?.name,
        'lastTriggeredAt': lastTriggeredAt?.toIso8601String(),
      };

  factory Alert.fromJson(Map<String, dynamic> json) {
    return Alert(
      id: json['id'] as String,
      type: AlertType.values.byName(json['type'] as String),
      symbol: json['symbol'] as String,
      isEnabled: json['isEnabled'] as bool,
      createdAt: DateTime.parse(json['createdAt'] as String),
      priceTarget: (json['priceTarget'] as num?)?.toDouble(),
      priceDirection: json['priceDirection'] != null
          ? PriceDirection.values.byName(json['priceDirection'] as String)
          : null,
      percentageThreshold: (json['percentageThreshold'] as num?)?.toDouble(),
      eventKeyword: json['eventKeyword'] as String?,
      radarTransition: json['radarTransition'] != null
          ? RadarTransition.values.byName(json['radarTransition'] as String)
          : null,
      lastTriggeredAt: json['lastTriggeredAt'] != null
          ? DateTime.parse(json['lastTriggeredAt'] as String)
          : null,
    );
  }
}

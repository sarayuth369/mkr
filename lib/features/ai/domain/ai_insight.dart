import 'package:flutter/foundation.dart';

/// Structured AI output. Every field is descriptive/analytical text — never
/// a buy/sell instruction or a guaranteed prediction.
@immutable
class AIInsight {
  const AIInsight({
    required this.summary,
    required this.whyItMatters,
    required this.marketImpact,
    required this.whatToWatch,
    required this.risks,
    required this.generatedAt,
  });

  final String summary;
  final String whyItMatters;
  final String marketImpact;
  final List<String> whatToWatch;
  final List<String> risks;
  final DateTime generatedAt;
}

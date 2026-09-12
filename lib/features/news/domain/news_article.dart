import 'package:flutter/foundation.dart';

import '../../../domain/impact_level.dart';

@immutable
class NewsArticle {
  const NewsArticle({
    required this.id,
    required this.headline,
    required this.source,
    required this.timestamp,
    required this.category,
    required this.impact,
    required this.affectedAssets,
    required this.summary,
    this.isMock = true,
  });

  final String id;
  final String headline;
  final String source;
  final DateTime timestamp;
  final String category;
  final ImpactLevel impact;
  final List<String> affectedAssets;
  final String summary;

  /// Always true in Phase 1 — surfaced in the UI so mock news is never
  /// mistaken for a real feed.
  final bool isMock;
}

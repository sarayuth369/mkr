/// Shared severity scale used by Today's Radar, News Radar, Economic
/// Calendar and Alerts (Radar type).
enum ImpactLevel { high, medium, low }

extension ImpactLevelX on ImpactLevel {
  String get label => switch (this) {
        ImpactLevel.high => 'HIGH',
        ImpactLevel.medium => 'MEDIUM',
        ImpactLevel.low => 'LOW',
      };

  int get sortWeight => switch (this) {
        ImpactLevel.high => 0,
        ImpactLevel.medium => 1,
        ImpactLevel.low => 2,
      };
}

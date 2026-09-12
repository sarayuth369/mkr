import 'package:flutter/material.dart';

/// Semantic colors not covered by [ColorScheme] (gain/loss/impact) that the
/// design-system widgets read via [Theme.of(context).extension].
@immutable
class MarketColors extends ThemeExtension<MarketColors> {
  const MarketColors({
    required this.gain,
    required this.loss,
    required this.neutral,
    required this.impactHigh,
    required this.impactMedium,
    required this.impactLow,
  });

  final Color gain;
  final Color loss;
  final Color neutral;
  final Color impactHigh;
  final Color impactMedium;
  final Color impactLow;

  static const light = MarketColors(
    gain: Color(0xFF1B8A5A),
    loss: Color(0xFFD1373F),
    neutral: Color(0xFF6B7280),
    impactHigh: Color(0xFFD1373F),
    impactMedium: Color(0xFFB8860B),
    impactLow: Color(0xFF6B7280),
  );

  static const dark = MarketColors(
    gain: Color(0xFF3DDC97),
    loss: Color(0xFFFF6B6B),
    neutral: Color(0xFF9CA3AF),
    impactHigh: Color(0xFFFF6B6B),
    impactMedium: Color(0xFFE0B341),
    impactLow: Color(0xFF9CA3AF),
  );

  @override
  MarketColors copyWith({
    Color? gain,
    Color? loss,
    Color? neutral,
    Color? impactHigh,
    Color? impactMedium,
    Color? impactLow,
  }) {
    return MarketColors(
      gain: gain ?? this.gain,
      loss: loss ?? this.loss,
      neutral: neutral ?? this.neutral,
      impactHigh: impactHigh ?? this.impactHigh,
      impactMedium: impactMedium ?? this.impactMedium,
      impactLow: impactLow ?? this.impactLow,
    );
  }

  @override
  MarketColors lerp(ThemeExtension<MarketColors>? other, double t) {
    if (other is! MarketColors) return this;
    return MarketColors(
      gain: Color.lerp(gain, other.gain, t)!,
      loss: Color.lerp(loss, other.loss, t)!,
      neutral: Color.lerp(neutral, other.neutral, t)!,
      impactHigh: Color.lerp(impactHigh, other.impactHigh, t)!,
      impactMedium: Color.lerp(impactMedium, other.impactMedium, t)!,
      impactLow: Color.lerp(impactLow, other.impactLow, t)!,
    );
  }
}

class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

class AppTheme {
  AppTheme._();

  static const _seed = Color(0xFF1857A4);

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: Brightness.light,
    );
    return _base(scheme, MarketColors.light);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: Brightness.dark,
    );
    return _base(scheme, MarketColors.dark);
  }

  static ThemeData _base(ColorScheme scheme, MarketColors marketColors) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      extensions: [marketColors],
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainer,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        margin: EdgeInsets.zero,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: scheme.surfaceContainerHigh,
        labelStyle: TextStyle(color: scheme.onSurface, fontSize: 12),
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        centerTitle: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.primaryContainer,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHigh,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.md,
        ),
      ),
    );
  }
}

extension MarketColorsX on BuildContext {
  MarketColors get marketColors =>
      Theme.of(this).extension<MarketColors>() ?? MarketColors.light;
}

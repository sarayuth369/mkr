import 'package:flutter/material.dart';

/// Semantic colors not covered by [ColorScheme]: gain/loss/impact plus the
/// four data-honesty states (live/demo/stale/offline) shown next to any
/// market data so the UI never implies real-time data it doesn't have.
@immutable
class MarketColors extends ThemeExtension<MarketColors> {
  const MarketColors({
    required this.gain,
    required this.loss,
    required this.neutral,
    required this.impactHigh,
    required this.impactMedium,
    required this.impactLow,
    required this.live,
    required this.demo,
    required this.stale,
    required this.offline,
    required this.aiAccent,
    required this.premiumAccent,
  });

  final Color gain;
  final Color loss;
  final Color neutral;
  final Color impactHigh;
  final Color impactMedium;
  final Color impactLow;
  final Color live;
  final Color demo;
  final Color stale;
  final Color offline;

  /// Violet/indigo accent reserved for AI-generated content (AI Market
  /// Brief, AI Ask) — keeps AI surfaces visually distinct from plain market
  /// data without looking like a generic chatbot.
  final Color aiAccent;

  /// Accent for Premium/subscription surfaces (paywall hero, Settings
  /// upsell card).
  final Color premiumAccent;

  static const light = MarketColors(
    gain: Color(0xFF1B8A5A),
    loss: Color(0xFFD1373F),
    neutral: Color(0xFF6B7280),
    impactHigh: Color(0xFFD1373F),
    impactMedium: Color(0xFFB8860B),
    impactLow: Color(0xFF6B7280),
    live: Color(0xFF1B8A5A),
    demo: Color(0xFF8A6D1B),
    stale: Color(0xFFB56A1E),
    offline: Color(0xFF8A2E2E),
    aiAccent: Color(0xFF6D5BD0),
    premiumAccent: Color(0xFF7C3AED),
  );

  static const dark = MarketColors(
    gain: Color(0xFF3DDC97),
    loss: Color(0xFFFF6B6B),
    neutral: Color(0xFF9CA3AF),
    impactHigh: Color(0xFFFF6B6B),
    impactMedium: Color(0xFFE0B341),
    impactLow: Color(0xFF9CA3AF),
    live: Color(0xFF3DDC97),
    demo: Color(0xFFE0B341),
    stale: Color(0xFFE08D41),
    offline: Color(0xFFFF6B6B),
    aiAccent: Color(0xFF9C8CFF),
    premiumAccent: Color(0xFFB18AFF),
  );

  @override
  MarketColors copyWith({
    Color? gain,
    Color? loss,
    Color? neutral,
    Color? impactHigh,
    Color? impactMedium,
    Color? impactLow,
    Color? live,
    Color? demo,
    Color? stale,
    Color? offline,
    Color? aiAccent,
    Color? premiumAccent,
  }) {
    return MarketColors(
      gain: gain ?? this.gain,
      loss: loss ?? this.loss,
      neutral: neutral ?? this.neutral,
      impactHigh: impactHigh ?? this.impactHigh,
      impactMedium: impactMedium ?? this.impactMedium,
      impactLow: impactLow ?? this.impactLow,
      live: live ?? this.live,
      demo: demo ?? this.demo,
      stale: stale ?? this.stale,
      offline: offline ?? this.offline,
      aiAccent: aiAccent ?? this.aiAccent,
      premiumAccent: premiumAccent ?? this.premiumAccent,
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
      live: Color.lerp(live, other.live, t)!,
      demo: Color.lerp(demo, other.demo, t)!,
      stale: Color.lerp(stale, other.stale, t)!,
      offline: Color.lerp(offline, other.offline, t)!,
      aiAccent: Color.lerp(aiAccent, other.aiAccent, t)!,
      premiumAccent: Color.lerp(premiumAccent, other.premiumAccent, t)!,
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

  static TextTheme _textTheme(ColorScheme scheme) {
    final base = Typography.material2021().black;
    return base.copyWith(
      // Screen title (AppBar).
      titleLarge: base.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2),
      // Section title ("Market Pulse", "Today's Radar", ...).
      titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.1),
      // Asset symbol (BTC, XAU/USD, ...).
      titleSmall: base.titleSmall?.copyWith(fontWeight: FontWeight.w700),
      // Price — tabular figures so digits align in lists as they change.
      headlineSmall: base.headlineSmall?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.3,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
      headlineMedium: base.headlineMedium?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.4,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
      // Percentage / change.
      bodyMedium: base.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      // Secondary metadata — muted, smaller.
      bodySmall: base.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
      labelSmall: base.labelSmall?.copyWith(color: scheme.onSurfaceVariant, letterSpacing: 0.2),
    );
  }

  static ThemeData _base(ColorScheme scheme, MarketColors marketColors) {
    final textTheme = _textTheme(scheme).apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      extensions: [marketColors],
      textTheme: textTheme,
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

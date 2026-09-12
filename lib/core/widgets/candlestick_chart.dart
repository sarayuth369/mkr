import 'package:flutter/material.dart';

import '../../domain/market_candle.dart';
import '../theme/app_theme.dart';

/// Real OHLC candlestick rendering (not a line chart pretending to be one).
/// Hand-painted rather than pulling in a chart package — keeps the
/// dependency surface unchanged and the rendering fully under our control,
/// same approach already used by [Sparkline].
class CandlestickChart extends StatelessWidget {
  const CandlestickChart({super.key, required this.candles, this.height = 180});

  final List<MarketCandle> candles;
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = context.marketColors;
    if (candles.length < 2) {
      return SizedBox(height: height);
    }
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(
        painter: _CandlestickPainter(
          candles: candles,
          bullColor: colors.gain,
          bearColor: colors.loss,
        ),
      ),
    );
  }
}

class _CandlestickPainter extends CustomPainter {
  _CandlestickPainter({required this.candles, required this.bullColor, required this.bearColor});

  final List<MarketCandle> candles;
  final Color bullColor;
  final Color bearColor;

  @override
  void paint(Canvas canvas, Size size) {
    final high = candles.map((c) => c.high).reduce((a, b) => a > b ? a : b);
    final low = candles.map((c) => c.low).reduce((a, b) => a < b ? a : b);
    final range = (high - low).abs() < 1e-9 ? 1.0 : high - low;
    final pad = range * 0.08;
    final minY = low - pad;
    final maxY = high + pad;
    final spanY = maxY - minY;

    double yFor(double value) => size.height - ((value - minY) / spanY) * size.height;

    final slotWidth = size.width / candles.length;
    final bodyWidth = (slotWidth * 0.6).clamp(1.0, 14.0);

    for (var i = 0; i < candles.length; i++) {
      final candle = candles[i];
      final cx = slotWidth * i + slotWidth / 2;
      final color = candle.isBullish ? bullColor : bearColor;

      final wickPaint = Paint()
        ..color = color
        ..strokeWidth = 1.4;
      canvas.drawLine(Offset(cx, yFor(candle.high)), Offset(cx, yFor(candle.low)), wickPaint);

      final bodyTop = yFor(candle.open > candle.close ? candle.open : candle.close);
      final bodyBottom = yFor(candle.open > candle.close ? candle.close : candle.open);
      final bodyRect = Rect.fromLTRB(
        cx - bodyWidth / 2,
        bodyTop,
        cx + bodyWidth / 2,
        (bodyBottom - bodyTop).abs() < 1.2 ? bodyTop + 1.2 : bodyBottom,
      );
      canvas.drawRect(bodyRect, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(covariant _CandlestickPainter oldDelegate) => oldDelegate.candles != candles;
}

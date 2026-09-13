import 'package:flutter/material.dart';

import '../../domain/market_candle.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// Real OHLC candlestick rendering (not a line chart pretending to be one).
/// Hand-painted rather than pulling in a chart package — keeps the
/// dependency surface unchanged and the rendering fully under our control,
/// same approach already used by [Sparkline].
///
/// Supports a lightweight interaction set (not a TradingView clone): pinch/
/// drag to change the visible window, tap a candle to inspect its OHLC, a
/// current-price marker, and price/time axis labels. [isStale] dims the
/// palette so a stale-but-still-rendered chart never reads as fresh live
/// data (the [MarketDataStatusChip] elsewhere on screen carries the actual
/// LIVE/STALE/OFFLINE label — this is just a visual echo of it).
class CandlestickChart extends StatefulWidget {
  const CandlestickChart({super.key, required this.candles, this.height = 220, this.isStale = false});

  final List<MarketCandle> candles;
  final double height;
  final bool isStale;

  @override
  State<CandlestickChart> createState() => _CandlestickChartState();
}

class _CandlestickChartState extends State<CandlestickChart> {
  static const _minVisible = 12;
  static const _priceAxisWidth = 56.0;
  static const _timeAxisHeight = 20.0;

  late int _visibleCount;
  late int _startIndex;
  int? _tappedIndex;

  double? _gestureStartVisible;
  int? _gestureStartIndex;

  @override
  void initState() {
    super.initState();
    _resetWindow();
  }

  @override
  void didUpdateWidget(covariant CandlestickChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.candles.length != widget.candles.length) {
      final wasPinnedToEnd = _startIndex + _visibleCount >= oldWidget.candles.length;
      _visibleCount = _visibleCount.clamp(_minVisible, widget.candles.length.clamp(_minVisible, 1 << 30));
      _startIndex = wasPinnedToEnd
          ? (widget.candles.length - _visibleCount).clamp(0, widget.candles.length)
          : _startIndex.clamp(0, (widget.candles.length - _visibleCount).clamp(0, widget.candles.length));
      _tappedIndex = null;
    }
  }

  void _resetWindow() {
    _visibleCount = widget.candles.length.clamp(_minVisible, 100);
    _startIndex = (widget.candles.length - _visibleCount).clamp(0, widget.candles.length);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.marketColors;
    final theme = Theme.of(context);
    if (widget.candles.length < 2) {
      return SizedBox(height: widget.height);
    }

    final visible = widget.candles.sublist(_startIndex, (_startIndex + _visibleCount).clamp(0, widget.candles.length));
    final hasVolume = visible.any((c) => c.volume != null);
    final opacity = widget.isStale ? 0.55 : 1.0;
    final totalHeight = widget.height + _timeAxisHeight + (hasVolume ? 40 : 0);
    final inspected = _tappedIndex != null && _tappedIndex! < visible.length ? visible[_tappedIndex!] : null;

    return SizedBox(
      height: totalHeight,
      width: double.infinity,
      child: Stack(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onScaleStart: (_) {
              _gestureStartVisible = _visibleCount.toDouble();
              _gestureStartIndex = _startIndex;
            },
            onScaleUpdate: (details) => _handleScaleUpdate(details, widget.candles.length),
            onTapUp: (details) => _handleTap(details, visible.length),
            child: CustomPaint(
              size: Size.infinite,
              painter: _CandlestickPainter(
                candles: visible,
                bullColor: colors.gain.withValues(alpha: opacity),
                bearColor: colors.loss.withValues(alpha: opacity),
                gridColor: theme.colorScheme.outlineVariant.withValues(alpha: opacity * 0.4),
                priceAxisWidth: _priceAxisWidth,
                timeAxisHeight: _timeAxisHeight,
                plotHeight: widget.height,
                hasVolume: hasVolume,
                tappedIndex: _tappedIndex,
                textStyle: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant.withValues(alpha: opacity)) ??
                    const TextStyle(fontSize: 10),
              ),
            ),
          ),
          if (inspected != null)
            Positioned(
              left: 4,
              top: 4,
              child: _OhlcInspectBox(candle: inspected),
            ),
        ],
      ),
    );
  }

  void _handleScaleUpdate(ScaleUpdateDetails details, int totalCandles) {
    final startVisible = _gestureStartVisible;
    final startIndex = _gestureStartIndex;
    if (startVisible == null || startIndex == null) return;
    final plotWidth = (context.size?.width ?? 320) - _priceAxisWidth;
    final newVisible = (startVisible / details.scale).clamp(_minVisible.toDouble(), totalCandles.toDouble()).round();
    final slotWidth = plotWidth / newVisible;
    final indexDelta = slotWidth > 0 ? -(details.focalPointDelta.dx / slotWidth).round() : 0;
    setState(() {
      _visibleCount = newVisible;
      _startIndex = (_startIndex + indexDelta).clamp(0, (totalCandles - newVisible).clamp(0, totalCandles));
      _tappedIndex = null;
    });
  }

  void _handleTap(TapUpDetails details, int visibleLength) {
    final plotWidth = (context.size?.width ?? 320) - _priceAxisWidth;
    if (details.localPosition.dx > plotWidth) return;
    final slotWidth = plotWidth / visibleLength;
    final index = (details.localPosition.dx / slotWidth).floor().clamp(0, visibleLength - 1);
    setState(() => _tappedIndex = _tappedIndex == index ? null : index);
  }
}

class _OhlcInspectBox extends StatelessWidget {
  const _OhlcInspectBox({required this.candle});

  final MarketCandle candle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = context.marketColors;
    final color = candle.isBullish ? colors.gain : colors.loss;
    final style = theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurface);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(Formatters.dateTime(candle.time), style: style),
          Text('O ${Formatters.price(candle.open)}  H ${Formatters.price(candle.high)}', style: style),
          Text('L ${Formatters.price(candle.low)}  C ${Formatters.price(candle.close)}', style: style?.copyWith(color: color, fontWeight: FontWeight.w700)),
          if (candle.volume != null) Text('Vol ${Formatters.volume(candle.volume!)}', style: style),
        ],
      ),
    );
  }
}

class _CandlestickPainter extends CustomPainter {
  _CandlestickPainter({
    required this.candles,
    required this.bullColor,
    required this.bearColor,
    required this.gridColor,
    required this.priceAxisWidth,
    required this.timeAxisHeight,
    required this.plotHeight,
    required this.hasVolume,
    required this.tappedIndex,
    required this.textStyle,
  });

  final List<MarketCandle> candles;
  final Color bullColor;
  final Color bearColor;
  final Color gridColor;
  final double priceAxisWidth;
  final double timeAxisHeight;
  final double plotHeight;
  final bool hasVolume;
  final int? tappedIndex;
  final TextStyle textStyle;

  @override
  void paint(Canvas canvas, Size size) {
    final plotWidth = size.width - priceAxisWidth;
    final high = candles.map((c) => c.high).reduce((a, b) => a > b ? a : b);
    final low = candles.map((c) => c.low).reduce((a, b) => a < b ? a : b);
    final range = (high - low).abs() < 1e-9 ? 1.0 : high - low;
    final pad = range * 0.08;
    final minY = low - pad;
    final maxY = high + pad;
    final spanY = maxY - minY;

    double yFor(double value) => plotHeight - ((value - minY) / spanY) * plotHeight;

    final slotWidth = plotWidth / candles.length;
    final bodyWidth = (slotWidth * 0.6).clamp(1.0, 14.0);

    // Price-axis gridlines + labels (4 evenly spaced levels).
    const gridLines = 4;
    for (var i = 0; i <= gridLines; i++) {
      final value = minY + spanY * i / gridLines;
      final y = yFor(value);
      canvas.drawLine(Offset(0, y), Offset(plotWidth, y), Paint()..color = gridColor..strokeWidth = 1);
      _paintText(canvas, Formatters.price(value), Offset(plotWidth + 4, y - 6));
    }

    // Time-axis labels (4 evenly spaced timestamps along the bottom).
    final useTimeOfDay = candles.last.time.difference(candles.first.time) < const Duration(days: 2);
    const timeLabels = 4;
    for (var i = 0; i <= timeLabels; i++) {
      final index = (candles.length - 1) * i ~/ timeLabels;
      final x = slotWidth * index + slotWidth / 2;
      final label = useTimeOfDay ? Formatters.time(candles[index].time) : Formatters.dateShort(candles[index].time);
      _paintText(canvas, label, Offset(x - 16, plotHeight + 4));
    }

    for (var i = 0; i < candles.length; i++) {
      final candle = candles[i];
      final cx = slotWidth * i + slotWidth / 2;
      final color = candle.isBullish ? bullColor : bearColor;

      if (tappedIndex == i) {
        canvas.drawRect(
          Rect.fromLTWH(slotWidth * i, 0, slotWidth, plotHeight),
          Paint()..color = color.withValues(alpha: 0.12),
        );
      }

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

      if (hasVolume && candle.volume != null) {
        final maxVolume = candles.map((c) => c.volume ?? 0).reduce((a, b) => a > b ? a : b);
        final volumeHeight = maxVolume <= 0 ? 0.0 : (candle.volume! / maxVolume) * 32;
        final volumeTop = plotHeight + timeAxisHeight + (32 - volumeHeight);
        canvas.drawRect(
          Rect.fromLTWH(cx - bodyWidth / 2, volumeTop, bodyWidth, volumeHeight),
          Paint()..color = color.withValues(alpha: 0.55),
        );
      }
    }

    // Current-price marker: dashed line at the last candle's close.
    final currentY = yFor(candles.last.close);
    final markerColor = candles.last.isBullish ? bullColor : bearColor;
    _drawDashedLine(canvas, Offset(0, currentY), Offset(plotWidth, currentY), markerColor);
    _paintText(canvas, Formatters.price(candles.last.close), Offset(plotWidth + 4, currentY - 6), background: markerColor);
  }

  void _drawDashedLine(Canvas canvas, Offset start, Offset end, Color color) {
    const dashWidth = 4.0;
    const dashSpace = 3.0;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    var current = start.dx;
    while (current < end.dx) {
      canvas.drawLine(Offset(current, start.dy), Offset((current + dashWidth).clamp(0, end.dx), start.dy), paint);
      current += dashWidth + dashSpace;
    }
  }

  void _paintText(Canvas canvas, String text, Offset offset, {Color? background}) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: background != null ? textStyle.copyWith(color: background, fontWeight: FontWeight.w700) : textStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(canvas, offset);
  }

  @override
  bool shouldRepaint(covariant _CandlestickPainter oldDelegate) =>
      oldDelegate.candles != candles || oldDelegate.tappedIndex != tappedIndex || oldDelegate.hasVolume != hasVolume;
}

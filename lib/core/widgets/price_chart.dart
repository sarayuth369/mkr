import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

enum ChartTimeframe { d1, w1, m1, m3, y1 }

extension ChartTimeframeX on ChartTimeframe {
  String get label => switch (this) {
        ChartTimeframe.d1 => '1D',
        ChartTimeframe.w1 => '1W',
        ChartTimeframe.m1 => '1M',
        ChartTimeframe.m3 => '3M',
        ChartTimeframe.y1 => '1Y',
      };
}

/// Lightweight line chart shared by Market Detail and Gold Radar. Not a
/// TradingView-level chart by design — optimized for a quick fast render.
class PriceChart extends StatefulWidget {
  const PriceChart({
    super.key,
    required this.series,
    required this.isUp,
    this.onTimeframeChanged,
    this.height = 180,
  });

  final List<double> series;
  final bool isUp;
  final ValueChanged<ChartTimeframe>? onTimeframeChanged;
  final double height;

  @override
  State<PriceChart> createState() => _PriceChartState();
}

class _PriceChartState extends State<PriceChart> {
  ChartTimeframe _timeframe = ChartTimeframe.d1;

  @override
  Widget build(BuildContext context) {
    final marketColors = context.marketColors;
    final lineColor = widget.isUp ? marketColors.gain : marketColors.loss;
    final spots = <FlSpot>[
      for (var i = 0; i < widget.series.length; i++) FlSpot(i.toDouble(), widget.series[i]),
    ];
    final minY = widget.series.isEmpty ? 0.0 : widget.series.reduce((a, b) => a < b ? a : b);
    final maxY = widget.series.isEmpty ? 1.0 : widget.series.reduce((a, b) => a > b ? a : b);
    final pad = (maxY - minY) * 0.1 + 0.0001;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: widget.height,
          child: LineChart(
            LineChartData(
              minY: minY - pad,
              maxY: maxY + pad,
              gridData: const FlGridData(show: false),
              titlesData: const FlTitlesData(show: false),
              borderData: FlBorderData(show: false),
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipColor: (_) => Theme.of(context).colorScheme.inverseSurface,
                ),
              ),
              lineBarsData: [
                LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  barWidth: 2.5,
                  color: lineColor,
                  dotData: const FlDotData(show: false),
                  belowBarData: BarAreaData(
                    show: true,
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [lineColor.withValues(alpha: 0.25), lineColor.withValues(alpha: 0.0)],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            for (final tf in ChartTimeframe.values)
              _TimeframeChip(
                label: tf.label,
                selected: tf == _timeframe,
                onTap: () {
                  setState(() => _timeframe = tf);
                  widget.onTimeframeChanged?.call(tf);
                },
              ),
          ],
        ),
      ],
    );
  }
}

class _TimeframeChip extends StatelessWidget {
  const _TimeframeChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? theme.colorScheme.primaryContainer : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelMedium?.copyWith(
            color: selected ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

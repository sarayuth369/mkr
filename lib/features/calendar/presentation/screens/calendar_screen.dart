import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/economic_event_card.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/mock_data_banner.dart';
import '../../../../domain/impact_level.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/mkr_ad_slot.dart';
import '../../application/calendar_controller.dart';
import '../../domain/economic_calendar_service.dart';
import '../../domain/economic_event.dart';

class CalendarScreen extends StatelessWidget {
  const CalendarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<CalendarController>();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.calendarTitle)),
      body: MkrAdBody(
        child: RefreshIndicator(
        onRefresh: controller.refresh,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  children: [
                    if (controller.isMock) ...[
                      const MockDataBanner(),
                      const SizedBox(height: 12),
                    ],
                    _RangeRow(controller: controller),
                    const SizedBox(height: 8),
                    _FreshnessRow(controller: controller),
                    const SizedBox(height: 8),
                    _FilterRow<ImpactLevel?>(
                      selected: controller.impactFilter,
                      options: [
                        MapEntry(l10n.filterAll, null),
                        MapEntry(l10n.filterHigh, ImpactLevel.high),
                        MapEntry(l10n.filterMedium, ImpactLevel.medium),
                        MapEntry(l10n.filterLow, ImpactLevel.low),
                      ],
                      onSelected: controller.setImpactFilter,
                    ),
                    const SizedBox(height: 8),
                    _FilterRow<String?>(
                      selected: controller.countryFilter,
                      options: [
                        MapEntry(l10n.filterAll, null),
                        for (final entry in CalendarController.countries.entries) MapEntry(entry.value, entry.key),
                      ],
                      onSelected: controller.setCountryFilter,
                    ),
                  ],
                ),
              ),
            ),
            controller.state.when(
              loading: () => const SliverPadding(
                padding: EdgeInsets.all(16),
                sliver: SliverToBoxAdapter(child: LoadingSkeletonList(rows: 4, rowHeight: 88)),
              ),
              error: (message) => SliverFillRemaining(
                child: ErrorState(message: message, onRetry: controller.refresh),
              ),
              empty: () => SliverFillRemaining(
                child: EmptyState(message: l10n.calendarNoEventsYet, icon: Icons.event_busy_outlined),
              ),
              success: (_, __, ___) => _EventList(controller: controller),
            ),
          ],
        ),
        ),
      ),
      bottomNavigationBar: const MkrBottomBannerAd(),
    );
  }
}

class _EventList extends StatelessWidget {
  const _EventList({required this.controller});

  final CalendarController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final events = controller.visibleEvents();
    if (events.isEmpty) {
      return SliverFillRemaining(
        child: EmptyState(message: l10n.calendarNoEventsMatchFilter, icon: Icons.filter_alt_off_outlined),
      );
    }

    final Map<String, List<EconomicEvent>> byDay = {};
    for (final event in events) {
      final key = Formatters.dateShort(event.dateTime);
      byDay.putIfAbsent(key, () => []).add(event);
    }

    return SliverPadding(
      padding: const EdgeInsets.all(16),
      sliver: SliverList.list(
        children: [
          for (final entry in byDay.entries) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: 8, top: 8),
              child: Text(entry.key, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            ),
            for (final event in entry.value)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: EconomicEventCard(event: event),
              ),
          ],
        ],
      ),
    );
  }
}

class _RangeRow extends StatelessWidget {
  const _RangeRow({required this.controller});

  final CalendarController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _FilterRow<CalendarRange>(
      selected: controller.range,
      options: [
        MapEntry(l10n.calendarRangeToday, CalendarRange.today),
        MapEntry(l10n.calendarRangeTomorrow, CalendarRange.tomorrow),
        MapEntry(l10n.calendarRangeWeek, CalendarRange.week),
      ],
      onSelected: controller.setRange,
    );
  }
}

/// Task requirement: "Show freshness/source status" - never implies the
/// data is LIVE merely because a list of events is showing (matches the
/// backend's own freshness.ts discipline).
class _FreshnessRow extends StatelessWidget {
  const _FreshnessRow({required this.controller});

  final CalendarController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final marketColors = context.marketColors;
    // 2026-09-17 Final UX/Reliability task: previously hardcoded raw
    // Material colors (Colors.green/orange) instead of the app's own
    // live/stale/offline semantic tokens - this dot is the same "data
    // honesty" indicator as MarketDataStatusChip elsewhere in the app, and
    // ignored the theme's dark-mode-tuned palette entirely.
    final (label, color) = switch (controller.freshness) {
      CalendarFreshness.live => (l10n.calendarFreshnessLive, marketColors.live),
      CalendarFreshness.stale => (l10n.calendarFreshnessStale, marketColors.stale),
      CalendarFreshness.degraded => (l10n.calendarFreshnessDegraded, marketColors.stale),
      CalendarFreshness.offline => (l10n.calendarFreshnessOffline, marketColors.offline),
    };
    return Row(
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        if (controller.lastUpdatedAt != null) ...[
          const SizedBox(width: 6),
          Text('· ${Formatters.relative(controller.lastUpdatedAt!)}', style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ],
      ],
    );
  }
}

class _FilterRow<T> extends StatelessWidget {
  const _FilterRow({
    required this.selected,
    required this.options,
    required this.onSelected,
  });

  final T selected;
  final List<MapEntry<String, T>> options;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      // Headroom above ChoiceChip's natural height at 1.0x text scale, so
      // the app-wide text-scale clamp (see MaterialApp's builder in
      // app.dart) never pushes a chip past this fixed height.
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final option = options[index];
          final isSelected = option.value == selected;
          return Center(
            child: ChoiceChip(
              label: Text(option.key),
              selected: isSelected,
              onSelected: (_) => onSelected(option.value),
            ),
          );
        },
      ),
    );
  }
}

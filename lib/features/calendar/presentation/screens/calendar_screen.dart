import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/economic_event_card.dart';
import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/mock_data_banner.dart';
import '../../../../domain/impact_level.dart';
import '../../application/calendar_controller.dart';
import '../../domain/economic_event.dart';

class CalendarScreen extends StatelessWidget {
  const CalendarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<CalendarController>();

    return Scaffold(
      appBar: AppBar(title: const Text('Economic Calendar')),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  children: [
                    const MockDataBanner(),
                    const SizedBox(height: 12),
                    _FilterRow(
                      label: 'Impact',
                      selected: controller.impactFilter?.label ?? 'All',
                      options: const ['All', 'High', 'Medium', 'Low'],
                      onSelected: (value) => controller.setImpactFilter(
                        value == 'All'
                            ? null
                            : ImpactLevel.values.firstWhere((l) => l.label == value.toUpperCase()),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _FilterRow(
                      label: 'Country',
                      selected: controller.countryFilter ?? 'All',
                      options: ['All', ...CalendarController.countries],
                      onSelected: (value) =>
                          controller.setCountryFilter(value == 'All' ? null : value),
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
              empty: () => const SliverFillRemaining(
                child: EmptyState(message: 'No events yet', icon: Icons.event_busy_outlined),
              ),
              success: (_, __, ___) => _EventList(controller: controller),
            ),
          ],
        ),
      ),
    );
  }
}

class _EventList extends StatelessWidget {
  const _EventList({required this.controller});

  final CalendarController controller;

  @override
  Widget build(BuildContext context) {
    final events = controller.visibleEvents();
    if (events.isEmpty) {
      return const SliverFillRemaining(
        child: EmptyState(message: 'No events match this filter', icon: Icons.filter_alt_off_outlined),
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

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.label,
    required this.selected,
    required this.options,
    required this.onSelected,
  });

  final String label;
  final String selected;
  final List<String> options;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final option = options[index];
          final isSelected = option == selected;
          return ChoiceChip(
            label: Text(option),
            selected: isSelected,
            onSelected: (_) => onSelected(option),
          );
        },
      ),
    );
  }
}

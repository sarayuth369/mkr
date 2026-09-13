import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../auth/application/auth_controller.dart';
import '../../domain/notification_history.dart';

class NotificationHistoryScreen extends StatelessWidget {
  const NotificationHistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final service = context.read<NotificationHistoryService>();
    final auth = context.watch<AuthController>();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.notificationHistoryTitle)),
      body: !service.isConfigured
          ? _MessageBody(text: l10n.notificationHistoryUnavailable)
          : auth.profile?.isGuest ?? true
              ? _MessageBody(text: l10n.notificationHistorySignInRequired)
              : FutureBuilder<List<NotificationHistoryEntry>>(
                  future: service.getRecent(),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    final entries = snapshot.data ?? const [];
                    if (entries.isEmpty) return _MessageBody(text: l10n.notificationHistoryEmpty);
                    return ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: entries.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) => _NotificationTile(entry: entries[index]),
                    );
                  },
                ),
    );
  }
}

class _MessageBody extends StatelessWidget {
  const _MessageBody({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.entry});

  final NotificationHistoryEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = context.marketColors;
    final failed = entry.status == NotificationDeliveryStatus.failed;
    return ListTile(
      leading: Icon(
        failed ? Icons.error_outline : Icons.notifications_active_outlined,
        color: failed ? colors.loss : colors.gain,
      ),
      title: Text(entry.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(entry.body, maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: Text(Formatters.time(entry.sentAt), style: theme.textTheme.labelSmall),
    );
  }
}

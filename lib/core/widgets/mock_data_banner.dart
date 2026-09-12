import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';

/// Unmistakable "this is demo data" banner for screens (News, Calendar)
/// whose spec explicitly requires mock content to never be confused with a
/// real feed.
class MockDataBanner extends StatelessWidget {
  const MockDataBanner({super.key, this.text});

  final String? text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, size: 16, color: theme.colorScheme.onTertiaryContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text ?? AppLocalizations.of(context).demoDataBanner,
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onTertiaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

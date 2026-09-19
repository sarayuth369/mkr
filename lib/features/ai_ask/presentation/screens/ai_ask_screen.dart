import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../billing/presentation/widgets/premium_gate.dart';
import '../../application/ai_ask_controller.dart';
import '../../domain/chat_message.dart';

class AiAskScreen extends StatefulWidget {
  const AiAskScreen({super.key});

  @override
  State<AiAskScreen> createState() => _AiAskScreenState();
}

class _AiAskScreenState extends State<AiAskScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _sendPrompt(String text) async {
    _inputController.clear();
    await context.read<AiAskController>().send(text);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final controller = context.watch<AiAskController>();
    final aiColor = context.marketColors.aiAccent;

    final suggestedPrompts = [
      l10n.aiAskPromptGoldOutlook,
      l10n.aiAskPromptFedImpact,
      l10n.aiAskPromptTopMovers,
      l10n.aiAskPromptMarketSummary,
      l10n.aiAskPromptExplainStock,
      l10n.aiAskPromptWhyMoving,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.aiAskTitle, style: theme.textTheme.titleMedium),
            Text(
              l10n.aiAskSubtitle,
              style: theme.textTheme.labelSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
      body: PremiumGate(
        isUnlocked: !controller.isLocked,
        featureName: l10n.aiAskTitle,
        child: Column(
        children: [
          Expanded(
            child: controller.messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.auto_awesome, size: 40, color: aiColor),
                          const SizedBox(height: 12),
                          Text(
                            l10n.aiAskSubtitle,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: controller.messages.length,
                    itemBuilder: (context, index) => _MessageBubble(message: controller.messages[index]),
                  ),
          ),
          if (controller.isResponding)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: aiColor)),
                  const SizedBox(width: 8),
                  Text(l10n.aiAskThinking, style: theme.textTheme.labelSmall),
                ],
              ),
            ),
          SizedBox(
            // Headroom above ActionChip's natural height at 1.0x text scale,
            // so the app-wide text-scale clamp (see MaterialApp's builder in
            // app.dart) never pushes a chip past this fixed height.
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: suggestedPrompts.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (context, index) => Center(
                child: ActionChip(
                  label: Text(suggestedPrompts[index]),
                  onPressed: controller.isResponding ? null : () => _sendPrompt(suggestedPrompts[index]),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: EdgeInsets.only(
              left: 12,
              right: 12,
              bottom: MediaQuery.of(context).viewInsets.bottom > 0 ? 12 : MediaQuery.of(context).padding.bottom + 12,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    decoration: InputDecoration(hintText: l10n.aiAskInputHint),
                    onSubmitted: controller.isResponding ? null : _sendPrompt,
                    textInputAction: TextInputAction.send,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: controller.isResponding ? null : () => _sendPrompt(_inputController.text),
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final isUser = message.role == ChatRole.user;
    final aiColor = context.marketColors.aiAccent;
    // 2026-09-17 Final UX/Reliability task: an error bubble previously
    // rendered the raw caught exception (e.g. "Exception: SocketException
    // ...") as if it were the assistant's own reply - a genuinely broken-
    // looking first impression on any network/provider failure. It now
    // substitutes the localized, friendly `aiAskError` string and uses the
    // theme's error container styling instead of the normal assistant
    // bubble, so a failure reads as "something went wrong" rather than a
    // stray stack trace pretending to be an answer.
    final isError = message.isError;

    final bubble = Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: isUser
            ? theme.colorScheme.primary
            : isError
                ? theme.colorScheme.errorContainer
                : theme.colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        isError ? l10n.aiAskError : message.text,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: isUser
              ? theme.colorScheme.onPrimary
              : isError
                  ? theme.colorScheme.onErrorContainer
                  : theme.colorScheme.onSurface,
        ),
      ),
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: isUser
            ? [bubble]
            : [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: isError ? theme.colorScheme.errorContainer : aiColor.withValues(alpha: 0.15),
                  child: Icon(
                    isError ? Icons.error_outline : Icons.auto_awesome,
                    size: 14,
                    color: isError ? theme.colorScheme.onErrorContainer : aiColor,
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(child: bubble),
              ],
      ),
    );
  }
}

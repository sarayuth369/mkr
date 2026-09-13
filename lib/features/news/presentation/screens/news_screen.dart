import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/widgets/empty_state.dart';
import '../../../../core/widgets/error_state.dart';
import '../../../../core/widgets/loading_skeleton.dart';
import '../../../../core/widgets/mock_data_banner.dart';
import '../../../../core/widgets/news_card.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../ads/presentation/widgets/mkr_ad_slot.dart';
import '../../application/news_controller.dart';

class NewsScreen extends StatelessWidget {
  const NewsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = context.watch<NewsController>();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.newsTitle)),
      body: MkrAdBody(
        child: RefreshIndicator(
        onRefresh: controller.refresh,
        child: controller.state.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(16),
            child: LoadingSkeletonList(rows: 4, rowHeight: 140),
          ),
          error: (message) => ErrorState(message: message, onRetry: controller.refresh),
          empty: () => ListView(
            children: [EmptyState(message: l10n.newsEmpty, icon: Icons.article_outlined)],
          ),
          success: (articles, isStale, lastUpdated) => ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: articles.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              if (index == 0) return const MockDataBanner();
              final article = articles[index - 1];
              return NewsCard(article: article);
            },
          ),
        ),
        ),
      ),
      bottomNavigationBar: const MkrBottomBannerAd(),
    );
  }
}

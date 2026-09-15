import 'package:flutter/material.dart';

/// One page of the Global Markets banner.
typedef GlobalMarketsPage = ({String headline, String subtitle});

/// Gradient hero banner on Home — a real (functional) multi-page carousel
/// built from data already on screen, not a decorative fake affordance.
class GlobalMarketsBanner extends StatefulWidget {
  const GlobalMarketsBanner({super.key, required this.title, required this.pages});

  final String title;
  final List<GlobalMarketsPage> pages;

  @override
  State<GlobalMarketsBanner> createState() => _GlobalMarketsBannerState();
}

class _GlobalMarketsBannerState extends State<GlobalMarketsBanner> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.pages.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [scheme.primary, scheme.primaryContainer.withValues(alpha: 0.9)],
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(Icons.public, size: 16, color: scheme.onPrimary.withValues(alpha: 0.85)),
              const SizedBox(width: 6),
              Text(
                widget.title,
                style: TextStyle(
                  color: scheme.onPrimary.withValues(alpha: 0.85),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            // Headroom above the headline+subtitle pair's natural height at
            // 1.0x text scale, so the app-wide text-scale clamp (see
            // MaterialApp's builder in app.dart) never pushes this past the
            // fixed height and overflows.
            height: 64,
            child: PageView.builder(
              controller: _controller,
              itemCount: widget.pages.length,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (context, index) {
                final page = widget.pages[index];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      page.headline,
                      style: TextStyle(color: scheme.onPrimary, fontSize: 17, fontWeight: FontWeight.w800),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      page.subtitle,
                      style: TextStyle(color: scheme.onPrimary.withValues(alpha: 0.85), fontSize: 12),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < widget.pages.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  width: i == _page ? 14 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: scheme.onPrimary.withValues(alpha: i == _page ? 0.95 : 0.4),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:mkr/features/billing/domain/product.dart';
import 'package:mkr/features/billing/presentation/premium_tier_label.dart';
import 'package:mkr/l10n/generated/app_localizations.dart';

void main() {
  test('every subscription price is in USD major units, matching the global pricing spec', () {
    expect(ProductCatalog.proMonthly.price, 2.99);
    expect(ProductCatalog.proYearly.price, 29.99);
    expect(ProductCatalog.aiProMonthly.price, 5.99);
    expect(ProductCatalog.aiProYearly.price, 59.99);
    expect(ProductCatalog.proLifetime.price, 79.99);
  });

  testWidgets('productPriceLabel formats USD amounts with the correct period wording', (tester) async {
    late AppLocalizations l10n;
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) {
            l10n = AppLocalizations.of(context);
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    expect(productPriceLabel(l10n, ProductCatalog.proMonthly), r'$2.99/month');
    expect(productPriceLabel(l10n, ProductCatalog.proYearly), r'$29.99/year');
    expect(productPriceLabel(l10n, ProductCatalog.aiProMonthly), r'$5.99/month');
    expect(productPriceLabel(l10n, ProductCatalog.aiProYearly), r'$59.99/year');
    expect(productPriceLabel(l10n, ProductCatalog.proLifetime), r'$79.99');
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/billing/domain/product.dart';
import 'package:mkr/features/billing/presentation/premium_tier_label.dart';

void main() {
  test('yearlySavingsPercent computes the correct rounded percentage for Pro', () {
    final percent = yearlySavingsPercent(ProductCatalog.proMonthly, ProductCatalog.proYearly);
    // 1 - 29.99/(2.99*12) ≈ 16.45% → rounds to 16.
    expect(percent, 16);
  });

  test('yearlySavingsPercent computes the correct rounded percentage for AI Pro', () {
    final percent = yearlySavingsPercent(ProductCatalog.aiProMonthly, ProductCatalog.aiProYearly);
    // 1 - 59.99/(5.99*12) ≈ 16.54% → rounds to 17.
    expect(percent, 17);
  });

  test('does not mutate or depend on Product.price values', () {
    // Locked by product_pricing_test.dart — re-assert here so a regression
    // in this file's own logic doesn't silently mask a price change.
    expect(ProductCatalog.proMonthly.price, 2.99);
    expect(ProductCatalog.proYearly.price, 29.99);
    expect(ProductCatalog.aiProMonthly.price, 5.99);
    expect(ProductCatalog.aiProYearly.price, 59.99);
  });
}

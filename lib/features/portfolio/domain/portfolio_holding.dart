import 'package:flutter/foundation.dart';

@immutable
class PortfolioHolding {
  const PortfolioHolding({
    required this.symbol,
    required this.quantity,
    required this.avgPrice,
  });

  final String symbol;
  final double quantity;
  final double avgPrice;

  Map<String, dynamic> toJson() => {
        'symbol': symbol,
        'quantity': quantity,
        'avgPrice': avgPrice,
      };

  factory PortfolioHolding.fromJson(Map<String, dynamic> json) => PortfolioHolding(
        symbol: json['symbol'] as String,
        quantity: (json['quantity'] as num).toDouble(),
        avgPrice: (json['avgPrice'] as num).toDouble(),
      );
}

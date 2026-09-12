import 'package:intl/intl.dart';

/// Shared number/date formatting so price/percentage/volume/time never get
/// formatted inconsistently across screens.
class Formatters {
  Formatters._();

  static String price(double value, {String currency = ''}) {
    final decimals = value.abs() < 10 ? 4 : 2;
    final formatted = NumberFormat.currency(
      symbol: '',
      decimalDigits: decimals,
    ).format(value);
    return currency.isEmpty ? formatted : '$formatted $currency';
  }

  static String changeAbs(double value) {
    final sign = value >= 0 ? '+' : '';
    return '$sign${NumberFormat('#,##0.00##').format(value)}';
  }

  static String changePct(double value) {
    final sign = value >= 0 ? '+' : '';
    return '$sign${value.toStringAsFixed(2)}%';
  }

  static String volume(double value) {
    if (value >= 1e9) return '${(value / 1e9).toStringAsFixed(2)}B';
    if (value >= 1e6) return '${(value / 1e6).toStringAsFixed(2)}M';
    if (value >= 1e3) return '${(value / 1e3).toStringAsFixed(2)}K';
    return value.toStringAsFixed(0);
  }

  static String time(DateTime dt) => DateFormat('HH:mm').format(dt);

  static String dateShort(DateTime dt) => DateFormat('MMM d').format(dt);

  static String dateTime(DateTime dt) => DateFormat('MMM d, HH:mm').format(dt);

  static String relative(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}

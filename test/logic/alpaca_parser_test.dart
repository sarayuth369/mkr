import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/features/markets/data/providers/alpaca_parser.dart';

void main() {
  group('parseSnapshot', () {
    test('parses a well-formed snapshot', () {
      final quote = AlpacaParser.parseSnapshot(
        json: const {
          'latestTrade': {'p': 227.5},
          'latestQuote': {'bp': 227.4, 'ap': 227.6},
          'prevDailyBar': {'c': 224.0},
          'dailyBar': {'o': 225.0, 'h': 228.0, 'l': 224.5, 'v': 1000},
        },
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNotNull);
      expect(quote!.price, 227.5);
      expect(quote.bid, 227.4);
      expect(quote.ask, 227.6);
      expect(quote.changeAbs, closeTo(3.5, 0.0001));
    });

    test('returns null for an error response', () {
      final quote = AlpacaParser.parseSnapshot(
        json: const {'code': 40010001, 'message': 'symbol not found'},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });

    test('returns null when latestTrade is missing', () {
      final quote = AlpacaParser.parseSnapshot(
        json: const {'latestQuote': {'bp': 1, 'ap': 2}},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });
  });

  group('parseBars', () {
    test('parses bars in original order', () {
      final candles = AlpacaParser.parseBars(const {
        'bars': [
          {'t': '2026-01-01T00:00:00Z', 'o': 1, 'h': 2, 'l': 0.5, 'c': 1.8, 'v': 5},
          {'t': '2026-01-02T00:00:00Z', 'o': 2, 'h': 3, 'l': 1, 'c': 2.5, 'v': 10},
        ],
      });
      expect(candles, hasLength(2));
      expect(candles.first.close, 1.8);
    });

    test('returns empty for missing bars or an error shape', () {
      expect(AlpacaParser.parseBars(const {'code': 1, 'message': 'x'}), isEmpty);
      expect(AlpacaParser.parseBars(const {}), isEmpty);
    });

    test('skips a malformed bar entry missing a required field', () {
      final candles = AlpacaParser.parseBars(const {
        'bars': [
          {'t': '2026-01-01T00:00:00Z', 'o': 1, 'h': 2, 'l': 0.5}, // no close
        ],
      });
      expect(candles, isEmpty);
    });

    // 2026-09-15 candle numeric validation correction task — a NaN/Infinity
    // OHLC value must be treated as malformed and skipped, never fabricated
    // or silently accepted into a candle.
    test('a NaN OHLC value is treated as malformed and skipped', () {
      final candles = AlpacaParser.parseBars(const {
        'bars': [
          {'t': '2026-01-01T00:00:00Z', 'o': double.nan, 'h': 2, 'l': 0.5, 'c': 1.8},
        ],
      });
      expect(candles, isEmpty);
    });

    test('an Infinity OHLC value is treated as malformed and skipped', () {
      final candles = AlpacaParser.parseBars(const {
        'bars': [
          {'t': '2026-01-01T00:00:00Z', 'o': 1, 'h': double.infinity, 'l': 0.5, 'c': 1.8},
        ],
      });
      expect(candles, isEmpty);
    });

    test('mixed valid + non-finite entries returns only the valid candle - never fabricated', () {
      final candles = AlpacaParser.parseBars(const {
        'bars': [
          {'t': '2026-01-01T00:00:00Z', 'o': 1, 'h': 2, 'l': 0.5, 'c': 1.8},
          {'t': '2026-01-02T00:00:00Z', 'o': double.infinity, 'h': 3, 'l': 1, 'c': 2.5},
        ],
      });
      expect(candles, hasLength(1));
      expect(candles.single.close, 1.8);
    });
  });

  group('parseWsTrade', () {
    test('parses a trade message', () {
      final quote = AlpacaParser.parseWsTrade(
        json: const {'T': 't', 'S': 'AAPL', 'p': 227.5},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote!.price, 227.5);
    });

    test('ignores non-trade message types', () {
      expect(
        AlpacaParser.parseWsTrade(
          json: const {'T': 'success', 'msg': 'connected'},
          mkrSymbol: 'AAPL',
          assetClass: AssetClass.usStock,
        ),
        isNull,
      );
    });
  });
}

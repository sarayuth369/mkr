import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/features/markets/data/providers/twelve_data_parser.dart';

void main() {
  group('parseQuote', () {
    test('parses a well-formed quote response', () {
      final quote = TwelveDataParser.parseQuote(
        json: const {
          'symbol': 'AAPL',
          'name': 'Apple Inc',
          'close': '227.50',
          'open': '225.00',
          'high': '228.10',
          'low': '224.80',
          'previous_close': '224.00',
          'change': '3.50',
          'percent_change': '1.56',
          'volume': '52000000',
          'currency': 'USD',
          'is_market_open': true,
        },
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNotNull);
      expect(quote!.price, 227.50);
      expect(quote.changePct, 1.56);
      expect(quote.isLive, isTrue);
    });

    test('returns null for an error-shaped response', () {
      final quote = TwelveDataParser.parseQuote(
        json: const {'status': 'error', 'code': 400, 'message': 'symbol not found'},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });

    test('returns null when the price field is missing entirely', () {
      final quote = TwelveDataParser.parseQuote(
        json: const {'symbol': 'AAPL', 'name': 'Apple Inc'},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });

    test('derives change/changePct from price and previous_close when absent', () {
      final quote = TwelveDataParser.parseQuote(
        json: const {'close': '110', 'previous_close': '100'},
        mkrSymbol: 'X',
        assetClass: AssetClass.usStock,
      );
      expect(quote!.changeAbs, 10);
      expect(quote.changePct, 10);
    });

    test('malformed non-numeric price string does not throw and returns null', () {
      final quote = TwelveDataParser.parseQuote(
        json: const {'close': 'not-a-number'},
        mkrSymbol: 'X',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });
  });

  group('isRateLimited', () {
    test('detects a 429 error code', () {
      expect(TwelveDataParser.isRateLimited(const {'status': 'error', 'code': 429, 'message': 'too many requests'}), isTrue);
    });

    test('detects an API-credits message even without code 429', () {
      expect(
        TwelveDataParser.isRateLimited(const {'status': 'error', 'code': 400, 'message': 'You have run out of API credits'}),
        isTrue,
      );
    });

    test('a normal error is not treated as rate-limited', () {
      expect(TwelveDataParser.isRateLimited(const {'status': 'error', 'code': 400, 'message': 'bad symbol'}), isFalse);
    });

    test('a success response is never rate-limited', () {
      expect(TwelveDataParser.isRateLimited(const {'close': '1.0'}), isFalse);
    });
  });

  group('parseCandles', () {
    test('parses newest-first values into oldest-first candles', () {
      final candles = TwelveDataParser.parseCandles(const {
        'values': [
          {'datetime': '2026-01-02', 'open': '2', 'high': '3', 'low': '1', 'close': '2.5', 'volume': '10'},
          {'datetime': '2026-01-01', 'open': '1', 'high': '2', 'low': '0.5', 'close': '1.8', 'volume': '5'},
        ],
      });
      expect(candles, hasLength(2));
      expect(candles.first.time, DateTime.parse('2026-01-01'));
      expect(candles.last.time, DateTime.parse('2026-01-02'));
    });

    test('skips entries missing a required OHLC field', () {
      final candles = TwelveDataParser.parseCandles(const {
        'values': [
          {'datetime': '2026-01-01', 'open': '1', 'high': '2', 'low': '0.5'}, // no close
        ],
      });
      expect(candles, isEmpty);
    });

    test('returns empty for an error-shaped response', () {
      final candles = TwelveDataParser.parseCandles(const {'status': 'error', 'code': 400, 'message': 'bad'});
      expect(candles, isEmpty);
    });

    test('returns empty when values is missing or not a list', () {
      expect(TwelveDataParser.parseCandles(const {}), isEmpty);
      expect(TwelveDataParser.parseCandles(const {'values': 'oops'}), isEmpty);
    });
  });

  group('parseWsPriceEvent', () {
    test('parses a price event', () {
      final quote = TwelveDataParser.parseWsPriceEvent(
        json: const {'event': 'price', 'symbol': 'AAPL', 'price': 228.10},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote!.price, 228.10);
    });

    test('ignores non-price events (e.g. subscribe-status, heartbeat)', () {
      expect(
        TwelveDataParser.parseWsPriceEvent(
          json: const {'event': 'subscribe-status', 'status': 'ok'},
          mkrSymbol: 'AAPL',
          assetClass: AssetClass.usStock,
        ),
        isNull,
      );
    });
  });
}

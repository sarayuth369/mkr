import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/domain/asset_class.dart';
import 'package:mkr/domain/market_data_source.dart';
import 'package:mkr/domain/market_session_status.dart';
import 'package:mkr/features/markets/data/providers/twelve_data_parser.dart';
import 'package:mkr/features/markets/domain/market_fetch_result.dart';

Map<String, dynamic> _envelope(Map<String, dynamic>? data) => {'success': true, 'data': data};
Map<String, dynamic> _listEnvelope(List<dynamic>? data) => {'success': true, 'data': data};

Map<String, dynamic> _errorEnvelope(String code, [String message = 'error']) => {
      'success': false,
      'error': {'code': code, 'message': message},
    };

void main() {
  group('parseQuote', () {
    test('parses a well-formed normalized quote envelope', () {
      final quote = TwelveDataParser.parseQuote(
        json: _envelope({
          'symbol': 'AAPL',
          'name': 'Apple Inc',
          'price': 227.50,
          'change': 3.50,
          'changePercent': 1.56,
          'open': 225.00,
          'high': 228.10,
          'low': 224.80,
          'previousClose': 224.00,
          'volume': 52000000,
          'bid': 227.40,
          'ask': 227.60,
          'currency': 'USD',
          'timestamp': 1234567890000,
          'source': 'twelve_data',
          'isLive': true,
          'sessionStatus': 'open',
        }),
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNotNull);
      expect(quote!.price, 227.50);
      expect(quote.changePct, 1.56);
      expect(quote.bid, 227.40);
      expect(quote.ask, 227.60);
      expect(quote.isLive, isTrue);
      expect(quote.source, MarketDataSource.twelveData);
      expect(quote.sessionStatus, MarketSessionStatus.open);
    });

    test('returns null for an error envelope', () {
      final quote = TwelveDataParser.parseQuote(
        json: _errorEnvelope('PROVIDER_UNAVAILABLE'),
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote, isNull);
    });

    test('returns null for a healthy-but-empty data:null body (never fabricated)', () {
      final quote = TwelveDataParser.parseQuote(json: _envelope(null), mkrSymbol: 'AAPL', assetClass: AssetClass.usStock);
      expect(quote, isNull);
    });

    test('returns null when the price field is missing entirely', () {
      final quote = TwelveDataParser.parseQuote(json: _envelope({'symbol': 'AAPL'}), mkrSymbol: 'AAPL', assetClass: AssetClass.usStock);
      expect(quote, isNull);
    });

    test('malformed non-numeric price does not throw and returns null', () {
      final quote = TwelveDataParser.parseQuote(json: _envelope({'price': 'oops'}), mkrSymbol: 'X', assetClass: AssetClass.usStock);
      expect(quote, isNull);
    });

    test('an unrecognized source string defaults to demo rather than throwing', () {
      final quote = TwelveDataParser.parseQuote(json: _envelope({'price': 1.0, 'source': 'mystery'}), mkrSymbol: 'X', assetClass: AssetClass.usStock);
      expect(quote!.source, MarketDataSource.demo);
    });
  });

  group('isRateLimited', () {
    test('detects the PROVIDER_RATE_LIMIT error code', () {
      expect(TwelveDataParser.isRateLimited(_errorEnvelope('PROVIDER_RATE_LIMIT')), isTrue);
    });

    test('a normal error is not treated as rate-limited', () {
      expect(TwelveDataParser.isRateLimited(_errorEnvelope('INVALID_SYMBOL')), isFalse);
    });

    test('a success envelope is never rate-limited', () {
      expect(TwelveDataParser.isRateLimited(_envelope({'price': 1.0})), isFalse);
    });
  });

  group('parseCandles', () {
    test('parses an already oldest-first candle array', () {
      final candles = TwelveDataParser.parseCandles(_listEnvelope([
        {'timestamp': 1735689600000, 'open': 1, 'high': 2, 'low': 0.5, 'close': 1.8, 'volume': 5, 'source': 'twelve_data'},
        {'timestamp': 1735776000000, 'open': 2, 'high': 3, 'low': 1, 'close': 2.5, 'volume': 10, 'source': 'twelve_data'},
      ]));
      expect(candles, hasLength(2));
      expect(candles.first.time.isBefore(candles.last.time), isTrue);
    });

    test('skips entries missing a required OHLC field', () {
      final candles = TwelveDataParser.parseCandles(_listEnvelope([
        {'timestamp': 1735689600000, 'open': 1, 'high': 2, 'low': 0.5}, // no close
      ]));
      expect(candles, isEmpty);
    });

    test('returns empty for an error envelope', () {
      expect(TwelveDataParser.parseCandles(_errorEnvelope('PROVIDER_UNAVAILABLE')), isEmpty);
    });

    test('returns empty when data is missing or not a list', () {
      expect(TwelveDataParser.parseCandles({'success': true}), isEmpty);
      expect(TwelveDataParser.parseCandles(_envelope(null)), isEmpty);
    });
  });

  group('parseMarketStatus', () {
    test('maps each session value', () {
      expect(TwelveDataParser.parseMarketStatus(_envelope({'session': 'open'})), MarketSessionStatus.open);
      expect(TwelveDataParser.parseMarketStatus(_envelope({'session': 'closed'})), MarketSessionStatus.closed);
      expect(TwelveDataParser.parseMarketStatus(_envelope({'session': 'pre_market'})), MarketSessionStatus.preMarket);
      expect(TwelveDataParser.parseMarketStatus(_envelope({'session': 'after_hours'})), MarketSessionStatus.afterHours);
    });

    test('defaults to unknown rather than guessing', () {
      expect(TwelveDataParser.parseMarketStatus(_errorEnvelope('PROVIDER_UNAVAILABLE')), MarketSessionStatus.unknown);
      expect(TwelveDataParser.parseMarketStatus(_envelope(null)), MarketSessionStatus.unknown);
    });
  });

  group('parseWsTick', () {
    test('parses a flat normalized tick frame', () {
      final quote = TwelveDataParser.parseWsTick(
        json: {'symbol': 'AAPL', 'price': 228.10, 'timestamp': 1234567890000, 'source': 'twelve_data'},
        mkrSymbol: 'AAPL',
        assetClass: AssetClass.usStock,
      );
      expect(quote!.price, 228.10);
      expect(quote.isLive, isTrue);
    });

    test('returns null for a frame missing a price', () {
      expect(
        TwelveDataParser.parseWsTick(json: {'symbol': 'AAPL'}, mkrSymbol: 'AAPL', assetClass: AssetClass.usStock),
        isNull,
      );
    });
  });

  group('parseQuotesBatchResult (2026-09-15 hardening task)', () {
    // Regression coverage for the "N individual /quote calls exhausts
    // Twelve Data Free's rate limit" bug found live: getQuotes() must
    // consume the batch endpoint's flat items array in one pass, not loop
    // parseQuote per symbol. ALSO regression coverage for the physical-
    // device bug this task exists to close: a provider failure/malformed
    // response must become a typed MarketFetchFailure, never silently
    // collapse into the same shape as a genuine empty result.
    test('parses every item in the batch response as MarketFetchSuccess', () {
      final result = TwelveDataParser.parseQuotesBatchResult(
        json: _envelope({
          'items': [
            {'symbol': 'AAPL', 'price': 227.5},
            {'symbol': 'XAU/USD', 'price': 3412.8},
          ],
          'errors': [],
        }),
        assetClassFor: (symbol) => symbol == 'XAU/USD' ? AssetClass.gold : AssetClass.usStock,
      );
      expect(result, isA<MarketFetchSuccess>());
      final quotes = result.quotes;
      expect(quotes, hasLength(2));
      expect(quotes.firstWhere((q) => q.symbol == 'AAPL').price, 227.5);
      expect(quotes.firstWhere((q) => q.symbol == 'XAU/USD').assetClass, AssetClass.gold);
      // Canonical symbol formats (both slash-containing and plain) survive intact.
      expect(quotes.map((q) => q.symbol), containsAll(['AAPL', 'XAU/USD']));
    });

    test('a partial batch (valid items + errors) becomes MarketFetchPartial - successful quotes stay visible, failed symbols are listed', () {
      final result = TwelveDataParser.parseQuotesBatchResult(
        json: _envelope({
          'items': [
            {'symbol': 'AAPL', 'price': 227.5},
          ],
          'errors': [
            {'symbol': 'MSFT', 'code': 'PROVIDER_UNAVAILABLE', 'message': 'unavailable'},
          ],
        }),
        assetClassFor: (_) => AssetClass.usStock,
      );
      expect(result, isA<MarketFetchPartial>());
      final partial = result as MarketFetchPartial;
      expect(partial.quotes.single.symbol, 'AAPL');
      expect(partial.failedSymbols, ['MSFT']);
    });

    test('an item missing a price is skipped, never fabricated - a zero-item, zero-error result is a genuine MarketFetchEmpty', () {
      final result = TwelveDataParser.parseQuotesBatchResult(
        json: _envelope({
          'items': [
            {'symbol': 'AAPL'},
          ],
          'errors': [],
        }),
        assetClassFor: (_) => AssetClass.usStock,
      );
      expect(result, isA<MarketFetchEmpty>());
    });

    test('every requested symbol failing (zero items, non-empty errors) is a MarketFetchFailure, not an empty result', () {
      final result = TwelveDataParser.parseQuotesBatchResult(
        json: _envelope({
          'items': [],
          'errors': [
            {'symbol': 'AAPL', 'code': 'PROVIDER_RATE_LIMIT', 'message': 'rate limited'},
          ],
        }),
        assetClassFor: (_) => AssetClass.usStock,
      );
      expect(result, isA<MarketFetchFailure>());
    });

    test('an error envelope (HTTP 429/5xx-classified) becomes MarketFetchFailure carrying the backend\'s message, never an empty result', () {
      final result = TwelveDataParser.parseQuotesBatchResult(json: _errorEnvelope('PROVIDER_UNAVAILABLE', 'Market data provider is currently unavailable.'), assetClassFor: (_) => AssetClass.usStock);
      expect(result, isA<MarketFetchFailure>());
      expect((result as MarketFetchFailure).message, 'Market data provider is currently unavailable.');
    });

    test('a malformed response (items missing or not a list) becomes MarketFetchFailure, never an empty result', () {
      final result = TwelveDataParser.parseQuotesBatchResult(json: _envelope(const {}), assetClassFor: (_) => AssetClass.usStock);
      expect(result, isA<MarketFetchFailure>());
    });

    test('a non-Map data body becomes MarketFetchFailure', () {
      final result = TwelveDataParser.parseQuotesBatchResult(json: _listEnvelope(const []), assetClassFor: (_) => AssetClass.usStock);
      expect(result, isA<MarketFetchFailure>());
    });
  });
}

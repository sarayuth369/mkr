import 'package:flutter_test/flutter_test.dart';
import 'package:mkr/features/markets/data/market_data_config.dart';

void main() {
  test('defaults to demo mode / Twelve Data primary / Alpaca secondary when values are empty', () {
    final config = MarketDataConfig.parse(
      modeValue: '',
      primaryValue: '',
      secondaryValue: '',
      backendBaseUrl: '',
      secondaryEnabled: false,
    );
    expect(config.mode, MarketDataRunMode.demo);
    expect(config.primaryProvider, MarketDataProviderId.twelveData);
    expect(config.secondaryProvider, isNull);
    expect(config.secondaryEnabled, isFalse);
  });

  test('parses "real" mode case-insensitively', () {
    expect(MarketDataConfig.parse(modeValue: 'REAL', primaryValue: '', secondaryValue: '', backendBaseUrl: '', secondaryEnabled: false).mode,
        MarketDataRunMode.real);
  });

  test('any value other than "real" is treated as demo', () {
    expect(
      MarketDataConfig.parse(modeValue: 'production', primaryValue: '', secondaryValue: '', backendBaseUrl: '', secondaryEnabled: false).mode,
      MarketDataRunMode.demo,
    );
  });

  test('parses provider ids case-insensitively, including the underscore spelling', () {
    final config = MarketDataConfig.parse(
      modeValue: 'real',
      primaryValue: 'TWELVE_DATA',
      secondaryValue: 'Alpaca',
      backendBaseUrl: 'https://example.com',
      secondaryEnabled: true,
    );
    expect(config.primaryProvider, MarketDataProviderId.twelveData);
    expect(config.secondaryProvider, MarketDataProviderId.alpaca);
    expect(config.backendBaseUrl, 'https://example.com');
    expect(config.secondaryEnabled, isTrue);
  });

  test('an unrecognized provider value falls back sensibly rather than throwing', () {
    final config = MarketDataConfig.parse(
      modeValue: 'real',
      primaryValue: 'bogus',
      secondaryValue: 'bogus',
      backendBaseUrl: '',
      secondaryEnabled: false,
    );
    expect(config.primaryProvider, MarketDataProviderId.twelveData);
    expect(config.secondaryProvider, isNull);
  });
}

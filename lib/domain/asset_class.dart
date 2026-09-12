/// Category an asset belongs to — drives which Markets tab section it's
/// listed under and which icon/format is used.
enum AssetClass { gold, usStock, indices, crypto, forex, thailand, commodity, rate }

extension AssetClassX on AssetClass {
  String get label => switch (this) {
        AssetClass.gold => 'Gold',
        AssetClass.usStock => 'US Stocks',
        AssetClass.indices => 'Indices',
        AssetClass.crypto => 'Crypto',
        AssetClass.forex => 'Forex',
        AssetClass.thailand => 'Thailand',
        AssetClass.commodity => 'Commodity',
        AssetClass.rate => 'Rate',
      };
}

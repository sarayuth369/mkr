import type { ProviderId } from '../types';
import type { SymbolRow } from './symbol-catalog';

/** Basic shape check before ever touching D1 - rejects obvious garbage/injection attempts cheaply. */
const SYMBOL_FORMAT = /^[A-Z0-9]{1,10}(\/[A-Z0-9]{1,10})?$/;

export function isValidMkrSymbolFormat(symbol: string): boolean {
  return SYMBOL_FORMAT.test(symbol);
}

/**
 * Pure mapping over an already-fetched row set - kept separate from
 * [SymbolCatalog] (which does the D1 fetch) so mapping logic is unit
 * testable without a database. Returns `null` when the symbol is unknown,
 * disabled, or the provider doesn't cover it - never guesses.
 */
export function mapSymbolFromRows(rows: SymbolRow[], symbol: string, provider: ProviderId): string | null {
  const row = rows.find((r) => r.symbol === symbol);
  if (!row || row.enabled === 0) return null;
  return provider === 'twelve_data' ? row.twelve_data_symbol : row.alpaca_symbol;
}

export function parseSymbolList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

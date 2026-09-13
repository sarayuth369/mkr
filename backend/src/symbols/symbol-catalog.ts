import type { Env, ProviderId } from '../types';

export interface SymbolRow {
  symbol: string;
  display_name: string;
  category: string;
  enabled: number;
  featured: number;
  sort_order: number;
  twelve_data_symbol: string | null;
  alpaca_symbol: string | null;
  default_timeframe: string;
  cache_ttl_seconds: number | null;
  updated_at: number;
}

/** D1-backed symbol catalog - the single source of truth for MKR<->provider symbol mapping on the backend. */
export class SymbolCatalog {
  constructor(private readonly db: D1Database) {}

  async all(): Promise<SymbolRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM symbols ORDER BY sort_order ASC').all<SymbolRow>();
    return results ?? [];
  }

  async get(symbol: string): Promise<SymbolRow | null> {
    const row = await this.db.prepare('SELECT * FROM symbols WHERE symbol = ?').bind(symbol).first<SymbolRow>();
    return row ?? null;
  }

  async providerSymbol(symbol: string, provider: ProviderId): Promise<string | null> {
    const row = await this.get(symbol);
    if (!row || row.enabled === 0) return null;
    return provider === 'twelve_data' ? row.twelve_data_symbol : row.alpaca_symbol;
  }

  async upsert(row: Omit<SymbolRow, 'updated_at'>): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO symbols (symbol, display_name, category, enabled, featured, sort_order, twelve_data_symbol, alpaca_symbol, default_timeframe, cache_ttl_seconds, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           display_name=excluded.display_name, category=excluded.category, enabled=excluded.enabled,
           featured=excluded.featured, sort_order=excluded.sort_order, twelve_data_symbol=excluded.twelve_data_symbol,
           alpaca_symbol=excluded.alpaca_symbol, default_timeframe=excluded.default_timeframe,
           cache_ttl_seconds=excluded.cache_ttl_seconds, updated_at=excluded.updated_at`,
      )
      .bind(
        row.symbol,
        row.display_name,
        row.category,
        row.enabled,
        row.featured,
        row.sort_order,
        row.twelve_data_symbol,
        row.alpaca_symbol,
        row.default_timeframe,
        row.cache_ttl_seconds,
        Date.now(),
      )
      .run();
  }

  async setEnabled(symbol: string, enabled: boolean): Promise<void> {
    await this.db.prepare('UPDATE symbols SET enabled = ?, updated_at = ? WHERE symbol = ?').bind(enabled ? 1 : 0, Date.now(), symbol).run();
  }
}

export function catalogFor(env: Env): SymbolCatalog {
  return new SymbolCatalog(env.MKR_DB);
}

import { ApiError, type ErrorCode } from '../errors';
import { ProviderError } from '../providers/types';
import type { MkrTimeframe } from '../types';
import { MKR_TIMEFRAMES } from '../types';

export function mapProviderError(err: unknown): ApiError {
  if (err instanceof ProviderError) {
    const code: ErrorCode =
      err.kind === 'timeout' ? 'PROVIDER_TIMEOUT' : err.kind === 'rate_limit' ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_UNAVAILABLE';
    // Never forward the raw provider message (may contain account/plan
    // detail) - only the fault category reaches Flutter.
    return new ApiError(code, 'Market data provider is currently unavailable.');
  }
  if (err instanceof ApiError) return err;
  return new ApiError('INTERNAL_ERROR', 'Unexpected server error.');
}

export function parseTimeframe(raw: string | null): MkrTimeframe {
  if (raw && (MKR_TIMEFRAMES as readonly string[]).includes(raw)) return raw as MkrTimeframe;
  throw new ApiError('INVALID_INTERVAL', `interval must be one of: ${MKR_TIMEFRAMES.join(', ')}`);
}

export function candleTtlFor(timeframe: MkrTimeframe, ttls: { candleIntradaySeconds: number; candleDailySeconds: number }): number {
  const intraday: MkrTimeframe[] = ['m1', 'm5', 'm15', 'h1', 'h4'];
  return intraday.includes(timeframe) ? ttls.candleIntradaySeconds : ttls.candleDailySeconds;
}

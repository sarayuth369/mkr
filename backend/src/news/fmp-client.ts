import { logError } from '../logging';
import { ApiError } from '../errors';

const BASE_URL = 'https://financialmodelingprep.com/stable';

/**
 * Thin Financial Modeling Prep REST client - Economic Calendar only (see
 * news-routes.ts's doc comment on why FMP and not Finnhub for this one
 * surface). Mirrors finnhub-client.ts's/twelve-data-provider.ts's
 * `request()` pattern: timeout, HTTP-status classification, JSON parse -
 * the key never leaves this Worker.
 */
export class FmpClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private url(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ ...params, apikey: this.apiKey });
    return `${BASE_URL}${path}?${query.toString()}`;
  }

  async request(path: string, params: Record<string, string>, timeoutMs = 8000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ApiError('PROVIDER_TIMEOUT', 'FMP request timed out.');
      throw new ApiError('PROVIDER_UNAVAILABLE', 'FMP network error.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) throw new ApiError('PROVIDER_UNAVAILABLE', 'FMP authentication failed.');
    if (response.status === 429) throw new ApiError('PROVIDER_RATE_LIMIT', 'FMP rate limit exceeded.');
    if (!response.ok) {
      logError('fmp request failed', { route: path, status: response.status });
      throw new ApiError('PROVIDER_UNAVAILABLE', 'FMP request failed.');
    }
    return response.json().catch(() => null);
  }
}

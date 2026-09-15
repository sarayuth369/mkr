import { logError } from '../logging';
import { ApiError } from '../errors';

const BASE_URL = 'https://finnhub.io/api/v1';

/**
 * Thin Finnhub REST client - mirrors twelve-data-provider.ts's `request()`
 * pattern (timeout, HTTP-status classification, JSON parse) so the same
 * operational lessons apply here: the API key never leaves this Worker,
 * every real HTTP attempt is timed out, and a malformed/error response
 * never crashes the caller.
 */
export class FinnhubClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private url(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ ...params, token: this.apiKey });
    return `${BASE_URL}${path}?${query.toString()}`;
  }

  async request(path: string, params: Record<string, string>, timeoutMs = 8000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ApiError('PROVIDER_TIMEOUT', 'Finnhub request timed out.');
      throw new ApiError('PROVIDER_UNAVAILABLE', 'Finnhub network error.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) throw new ApiError('PROVIDER_UNAVAILABLE', 'Finnhub authentication failed.');
    if (response.status === 429) throw new ApiError('PROVIDER_RATE_LIMIT', 'Finnhub rate limit exceeded.');
    if (!response.ok) {
      logError('finnhub request failed', { route: path, status: response.status });
      throw new ApiError('PROVIDER_UNAVAILABLE', 'Finnhub request failed.');
    }
    return response.json().catch(() => null);
  }
}

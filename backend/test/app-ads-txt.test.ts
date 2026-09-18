import { describe, expect, it } from 'vitest';
import { handleAppAdsTxt } from '../src/pages/app-ads-txt';

// 2026-09-18 app-ads.txt task - confirms the exact IAB/AdMob requirements:
// plain text, no auth/redirect/JSON wrapper, and the EXACT authorized-seller
// line the operator was shown in their own AdMob console - not invented,
// not extended with any other network/reseller line.
describe('GET /app-ads.txt', () => {
  it('returns HTTP 200 with a plain-text content type', async () => {
    const res = handleAppAdsTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });

  it('contains the exact authorized-seller line, verbatim', async () => {
    const body = await handleAppAdsTxt().text();
    expect(body).toContain('google.com, pub-1918372113970166, DIRECT, f08c47fec0942fa0');
  });

  it('contains exactly one non-empty line - no invented extra networks/resellers', async () => {
    const body = await handleAppAdsTxt().text();
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });

  it('is not wrapped in the API JSON envelope', async () => {
    const body = await handleAppAdsTxt().text();
    expect(body).not.toContain('"success"');
    expect(body).not.toContain('{');
  });

  it('never exposes an actual credential value', async () => {
    const body = await handleAppAdsTxt().text();
    expect(body).not.toMatch(/TWELVE_DATA_API_KEY|ALPACA_API_KEY_ID|ALPACA_API_SECRET_KEY|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

import { describe, expect, it } from 'vitest';
import { handleVerifyPurchase } from '../src/billing/verify-purchase-route';
import type { Env } from '../src/types';

// 2026-09-17 AdMob + Billing task - this handler never touches D1/KV/any
// Env field yet (no Google Play Developer API service account exists),
// so an empty fake Env is sufficient - confirms the honest "not
// configured" contract rather than a fabricated verification result.
const fakeEnv = {} as Env;

describe('POST /api/mkr/billing/verify-purchase', () => {
  it('honestly reports not_configured for a well-formed request - never fabricates a pass', async () => {
    const req = new Request('https://x/api/mkr/billing/verify-purchase', {
      method: 'POST',
      body: JSON.stringify({ purchaseToken: 'tok-123', productId: 'mkr_premium', packageName: 'com.mlabs.mkr' }),
    });

    const res = await handleVerifyPurchase(req, fakeEnv, 'r1');
    const body = (await res.json()) as { data: { verified: boolean; reason: string } };

    expect(res.status).toBe(200);
    expect(body.data.verified).toBe(false);
    expect(body.data.reason).toBe('not_configured');
  });

  it('rejects a request missing purchaseToken/productId with 400, not a silent pass', async () => {
    const req = new Request('https://x/api/mkr/billing/verify-purchase', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await handleVerifyPurchase(req, fakeEnv, 'r1');
    const body = (await res.json()) as { data: { verified: boolean; reason: string } };

    expect(res.status).toBe(400);
    expect(body.data.verified).toBe(false);
    expect(body.data.reason).toBe('invalid_request');
  });

  it('never echoes the purchase token back in the response', async () => {
    const req = new Request('https://x/api/mkr/billing/verify-purchase', {
      method: 'POST',
      body: JSON.stringify({ purchaseToken: 'super-secret-token-value', productId: 'mkr_premium_lifetime' }),
    });

    const res = await handleVerifyPurchase(req, fakeEnv, 'r1');
    const text = await res.text();

    expect(text).not.toContain('super-secret-token-value');
  });
});

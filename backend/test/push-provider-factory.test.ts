import { describe, expect, it } from 'vitest';
import { DisabledPushProvider } from '../src/push/disabled-provider';
import { FcmPushProvider } from '../src/push/fcm-provider';
import { getPushProvider } from '../src/push/provider-factory';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MKR_CONFIG: {} as never,
    MKR_CACHE: {} as never,
    MKR_DB: {} as never,
    MARKET_STREAM: {} as never,
    RATE_LIMITER: {} as never,
    MARKET_PRIMARY_PROVIDER: 'twelve_data',
    MARKET_SECONDARY_PROVIDER: 'alpaca',
    MARKET_SECONDARY_ENABLED: 'false',
    CACHE_QUOTE_TTL_SECONDS: '60',
    CACHE_CANDLE_INTRADAY_TTL_SECONDS: '60',
    CACHE_CANDLE_DAILY_TTL_SECONDS: '600',
    CACHE_STATUS_TTL_SECONDS: '60',
    STALE_THRESHOLD_SECONDS: '90',
    RATE_LIMIT_PUBLIC_PER_MINUTE: '60',
    RATE_LIMIT_ADMIN_PER_MINUTE: '120',
    RATE_LIMIT_WS_MAX_CONNECTIONS: '500',
    ADMIN_WEB_ORIGIN: 'https://mkr-admin.pages.dev',
    ...overrides,
  };
}

describe('getPushProvider', () => {
  it('returns DisabledPushProvider when no FCM credentials are configured', () => {
    const provider = getPushProvider(makeEnv());
    expect(provider).toBeInstanceOf(DisabledPushProvider);
    expect(provider.isConfigured).toBe(false);
  });

  it('returns DisabledPushProvider when only some FCM fields are set', () => {
    const provider = getPushProvider(makeEnv({ FCM_PROJECT_ID: 'mkr-app', FCM_CLIENT_EMAIL: 'svc@mkr-app.iam.gserviceaccount.com' }));
    expect(provider).toBeInstanceOf(DisabledPushProvider);
  });

  it('returns FcmPushProvider once all three FCM fields are present', () => {
    const provider = getPushProvider(
      makeEnv({
        FCM_PROJECT_ID: 'mkr-app',
        FCM_CLIENT_EMAIL: 'svc@mkr-app.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----',
      }),
    );
    expect(provider).toBeInstanceOf(FcmPushProvider);
    expect(provider.isConfigured).toBe(true);
  });
});

describe('DisabledPushProvider', () => {
  it('never reports success - a disabled provider must never fake a sent push', async () => {
    const result = await new DisabledPushProvider().send({ token: 'x' }, { title: 't', body: 'b' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('push_not_configured');
  });
});

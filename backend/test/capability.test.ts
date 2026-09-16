import { describe, expect, it } from 'vitest';
import { canStream, providerCanServe, resolvePreferredProvider } from '../src/providers/capability';

// Hybrid Provider Architecture task (2026-09-16) — pure capability/
// preference model tests. No network, no secrets, no Env - see this
// module's own doc comment for the capability/preference/activation split
// these tests pin.

describe('providerCanServe', () => {
  it('is capable when the D1 catalog has a mapping for this provider', () => {
    expect(providerCanServe(true)).toBe(true);
  });

  it('is never capable when the D1 catalog has no mapping - never guessed', () => {
    expect(providerCanServe(false)).toBe(false);
  });
});

describe('canStream', () => {
  it('Twelve Data can stream any symbol it has a mapping for - unchanged, the pool\'s existing sole upstream', () => {
    expect(canStream('twelve_data', true)).toBe(true);
  });

  it('Twelve Data cannot stream a symbol with no mapping', () => {
    expect(canStream('twelve_data', false)).toBe(false);
  });

  it('Alpaca streaming is always false regardless of mapping - not yet wired into the Market Pool (see this module\'s doc comment)', () => {
    expect(canStream('alpaca', true)).toBe(false);
    expect(canStream('alpaca', false)).toBe(false);
  });
});

describe('resolvePreferredProvider', () => {
  const offFlags = { hybridRoutingEnabled: false, hybridCryptoRoutingEnabled: false };
  const onFlags = { hybridRoutingEnabled: true, hybridCryptoRoutingEnabled: false };
  const onWithCryptoFlags = { hybridRoutingEnabled: true, hybridCryptoRoutingEnabled: true };

  it('never prefers Alpaca when there is no D1 mapping for it, regardless of flags', () => {
    expect(resolvePreferredProvider('us_stock', false, onWithCryptoFlags)).toBeNull();
    expect(resolvePreferredProvider('crypto', false, onWithCryptoFlags)).toBeNull();
  });

  it('never prefers Alpaca when the master switch is off, even with a real mapping', () => {
    expect(resolvePreferredProvider('us_stock', true, offFlags)).toBeNull();
  });

  it('prefers Alpaca for a mapped us_stock symbol once the master switch is on - well-documented capability, no extra gate needed', () => {
    expect(resolvePreferredProvider('us_stock', true, onFlags)).toBe('alpaca');
  });

  it('does NOT prefer Alpaca for a mapped crypto symbol just because the master switch is on - task: never infer from asset class alone', () => {
    expect(resolvePreferredProvider('crypto', true, onFlags)).toBeNull();
  });

  it('prefers Alpaca for crypto only once its OWN, separate crypto gate is also on', () => {
    expect(resolvePreferredProvider('crypto', true, onWithCryptoFlags)).toBe('alpaca');
  });

  it('never prefers Alpaca for forex/gold/indices/thailand, even with hybrid routing fully on - Alpaca genuinely has no mapping for these, but this is explicit regardless', () => {
    for (const category of ['forex', 'gold', 'indices', 'thailand', 'commodity', 'rate']) {
      expect(resolvePreferredProvider(category, true, onWithCryptoFlags)).toBeNull();
    }
  });
});

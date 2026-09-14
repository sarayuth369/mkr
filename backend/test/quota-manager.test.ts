import { afterEach, describe, expect, it } from 'vitest';
import { _resetQuotaUsageForTests, admitProviderRequest, budgetSnapshot, recordProviderRequest, tierForUsedFraction, type RequestPriority } from '../src/providers/quota-manager';

const DAY = Date.UTC(2026, 8, 14, 12, 0, 0);

afterEach(() => _resetQuotaUsageForTests());

describe('quota-manager - unconfigured budget (Task 6: never invent a provider quota)', () => {
  it('always allows every priority when dailyRequestBudget is 0 (fail-open, guard inactive)', () => {
    for (const p of ['P0', 'P1', 'P2', 'P3', 'P4'] as RequestPriority[]) {
      const decision = admitProviderRequest('twelve_data', p, { dailyRequestBudget: 0 }, DAY);
      expect(decision.allowed).toBe(true);
      expect(decision.budget).toBeNull();
    }
  });

  it('a negative or non-finite budget is also treated as unconfigured (defensive, never a hard denial from bad config)', () => {
    expect(admitProviderRequest('twelve_data', 'P4', { dailyRequestBudget: -5 }, DAY).allowed).toBe(true);
    expect(admitProviderRequest('twelve_data', 'P4', { dailyRequestBudget: NaN }, DAY).allowed).toBe(true);
  });
});

describe('tierForUsedFraction - threshold boundaries', () => {
  it('normal below 70%', () => {
    expect(tierForUsedFraction(0)).toBe('normal');
    expect(tierForUsedFraction(0.69)).toBe('normal');
  });
  it('reduced at 70-85%', () => {
    expect(tierForUsedFraction(0.7)).toBe('reduced');
    expect(tierForUsedFraction(0.84)).toBe('reduced');
  });
  it('emergency at 85-95%', () => {
    expect(tierForUsedFraction(0.85)).toBe('emergency');
    expect(tierForUsedFraction(0.94)).toBe('emergency');
  });
  it('critical at 95-100%', () => {
    expect(tierForUsedFraction(0.95)).toBe('critical');
    expect(tierForUsedFraction(0.999)).toBe('critical');
  });
  it('stopped at 100%+', () => {
    expect(tierForUsedFraction(1)).toBe('stopped');
    expect(tierForUsedFraction(1.5)).toBe('stopped');
  });
});

describe('priority ordering - one tier shed per threshold, lowest priority first', () => {
  const policy = { dailyRequestBudget: 100 };

  function fillTo(usedCount: number) {
    for (let i = 0; i < usedCount; i++) recordProviderRequest('twelve_data', DAY);
  }

  it('normal (<70 used): all priorities allowed', () => {
    fillTo(69);
    for (const p of ['P0', 'P1', 'P2', 'P3', 'P4'] as RequestPriority[]) {
      expect(admitProviderRequest('twelve_data', p, policy, DAY).allowed).toBe(true);
    }
  });

  it('reduced (70-84 used): only P4 denied', () => {
    fillTo(70);
    expect(admitProviderRequest('twelve_data', 'P4', policy, DAY).allowed).toBe(false);
    for (const p of ['P0', 'P1', 'P2', 'P3'] as RequestPriority[]) {
      expect(admitProviderRequest('twelve_data', p, policy, DAY).allowed).toBe(true);
    }
  });

  it('emergency (85-94 used): P3 and P4 denied', () => {
    fillTo(85);
    expect(admitProviderRequest('twelve_data', 'P3', policy, DAY).allowed).toBe(false);
    expect(admitProviderRequest('twelve_data', 'P4', policy, DAY).allowed).toBe(false);
    for (const p of ['P0', 'P1', 'P2'] as RequestPriority[]) {
      expect(admitProviderRequest('twelve_data', p, policy, DAY).allowed).toBe(true);
    }
  });

  it('critical (95-99 used): P2, P3, P4 denied', () => {
    fillTo(95);
    for (const p of ['P2', 'P3', 'P4'] as RequestPriority[]) {
      expect(admitProviderRequest('twelve_data', p, policy, DAY).allowed).toBe(false);
    }
    expect(admitProviderRequest('twelve_data', 'P0', policy, DAY).allowed).toBe(true);
    expect(admitProviderRequest('twelve_data', 'P1', policy, DAY).allowed).toBe(true);
  });

  it('stopped (100+ used): only P0 (active user/live + alerts) is ever allowed', () => {
    fillTo(100);
    expect(admitProviderRequest('twelve_data', 'P0', policy, DAY).allowed).toBe(true);
    for (const p of ['P1', 'P2', 'P3', 'P4'] as RequestPriority[]) {
      expect(admitProviderRequest('twelve_data', p, policy, DAY).allowed).toBe(false);
    }
  });

  it('P0 is NEVER denied by this guard at any usage level, including far over budget', () => {
    fillTo(500); // 5x over budget
    expect(admitProviderRequest('twelve_data', 'P0', policy, DAY).allowed).toBe(true);
  });
});

describe('provider isolation - Twelve Data and Alpaca never share a budget', () => {
  it('exhausting Twelve Data\'s budget does not affect Alpaca\'s admission', () => {
    const policy = { dailyRequestBudget: 10 };
    for (let i = 0; i < 10; i++) recordProviderRequest('twelve_data', DAY);

    expect(admitProviderRequest('twelve_data', 'P1', policy, DAY).allowed).toBe(false);
    expect(admitProviderRequest('alpaca', 'P1', policy, DAY).allowed).toBe(true); // untouched, separate counter
  });

  it('each provider can have a different budget configured', () => {
    for (let i = 0; i < 5; i++) recordProviderRequest('twelve_data', DAY);
    for (let i = 0; i < 5; i++) recordProviderRequest('alpaca', DAY);

    // Twelve Data: 5/10 = 50% (normal). Alpaca: 5/6 = 83% (reduced).
    expect(admitProviderRequest('twelve_data', 'P4', { dailyRequestBudget: 10 }, DAY).allowed).toBe(true);
    expect(admitProviderRequest('alpaca', 'P4', { dailyRequestBudget: 6 }, DAY).allowed).toBe(false);
  });
});

describe('daily window reset', () => {
  it('usage resets on a new UTC day', () => {
    const policy = { dailyRequestBudget: 5 };
    for (let i = 0; i < 5; i++) recordProviderRequest('twelve_data', DAY);
    expect(admitProviderRequest('twelve_data', 'P1', policy, DAY).allowed).toBe(false);

    const nextDay = DAY + 86_400_000;
    expect(admitProviderRequest('twelve_data', 'P1', policy, nextDay).allowed).toBe(true);
  });
});

describe('concurrency - sequential recordProviderRequest calls never lose a count (no async gap between admit and record within one caller)', () => {
  it('20 sequential admit+record cycles produce an exact count of 20, no races possible in a single-threaded call sequence', () => {
    const policy = { dailyRequestBudget: 1000 };
    let allowedCount = 0;
    for (let i = 0; i < 20; i++) {
      const decision = admitProviderRequest('twelve_data', 'P1', policy, DAY);
      if (decision.allowed) {
        recordProviderRequest('twelve_data', DAY);
        allowedCount++;
      }
    }
    expect(allowedCount).toBe(20);
    expect(admitProviderRequest('twelve_data', 'P1', policy, DAY).usedCount).toBe(20);
  });

  it('genuinely concurrent recordProviderRequest calls (Promise.all, matching how Twelve Data\'s chunk fan-out actually invokes it) never lose an increment', async () => {
    // recordProviderRequest itself has no `await` inside it, so even
    // though these 12 calls are all "in flight" concurrently (the way
    // TwelveDataProvider.getBatchQuotes' Promise.allSettled chunk fan-out
    // really invokes it - each chunk's own request() call records before
    // its network round-trip), each individual call still runs to
    // completion atomically under JS's single-threaded semantics.
    await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.resolve().then(() => {
          recordProviderRequest('twelve_data', DAY);
        }),
      ),
    );
    expect(admitProviderRequest('twelve_data', 'P1', { dailyRequestBudget: 1000 }, DAY).usedCount).toBe(12);
  });
});

describe('budgetSnapshot - read-only observability, never mutates state', () => {
  it('reports the current tier/usedFraction without recording a call', () => {
    const policy = { dailyRequestBudget: 10 };
    for (let i = 0; i < 7; i++) recordProviderRequest('twelve_data', DAY);

    const snapshotA = budgetSnapshot('twelve_data', policy, DAY);
    const snapshotB = budgetSnapshot('twelve_data', policy, DAY);

    expect(snapshotA.usedCount).toBe(7);
    expect(snapshotB.usedCount).toBe(7); // calling the snapshot twice did not itself consume budget
    expect(snapshotA.tier).toBe('reduced'); // 70%
    expect(snapshotA.provider).toBe('twelve_data');
  });

  it('reports budget: null when unconfigured', () => {
    const snapshot = budgetSnapshot('alpaca', { dailyRequestBudget: 0 }, DAY);
    expect(snapshot.budget).toBeNull();
    expect(snapshot.tier).toBe('normal');
  });
});

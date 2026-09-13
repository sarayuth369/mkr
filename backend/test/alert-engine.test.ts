import { describe, expect, it } from 'vitest';
import { conditionMet, isCooledDown } from '../src/alerts/alert-engine';

describe('conditionMet', () => {
  it('price_above triggers only strictly above the target', () => {
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3451)).toBe(true);
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3450)).toBe(false);
    expect(conditionMet({ condition_type: 'price_above', target_value: 3450 }, 3410)).toBe(false);
  });

  it('price_below triggers only strictly below the target', () => {
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 219.99)).toBe(true);
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 220)).toBe(false);
    expect(conditionMet({ condition_type: 'price_below', target_value: 220 }, 221)).toBe(false);
  });
});

describe('isCooledDown', () => {
  it('is always cooled down when never triggered before', () => {
    expect(isCooledDown(null, 3600, Date.now())).toBe(true);
  });

  it('refuses to re-trigger before the cooldown window elapses (never spam every tick)', () => {
    const lastTriggered = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oneMinuteLater = Date.parse(lastTriggered) + 60_000;
    expect(isCooledDown(lastTriggered, 3600, oneMinuteLater)).toBe(false);
  });

  it('allows re-triggering once the cooldown window has fully elapsed', () => {
    const lastTriggered = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const oneHourLater = Date.parse(lastTriggered) + 3600 * 1000;
    expect(isCooledDown(lastTriggered, 3600, oneHourLater)).toBe(true);
  });

  it('treats an unparseable timestamp as never-triggered rather than throwing', () => {
    expect(isCooledDown('not-a-date', 3600, Date.now())).toBe(true);
  });
});

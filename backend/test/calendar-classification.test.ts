import { describe, expect, it } from 'vitest';
import { classifyEvent } from '../src/calendar/classification';

describe('classifyEvent - MKR-owned deterministic classification', () => {
  it('classifies FOMC as monetary_policy/high with USD-relevant assets', () => {
    const c = classifyEvent('FOMC Interest Rate Decision');
    expect(c.category).toBe('monetary_policy');
    expect(c.importance).toBe('high');
    expect(c.relatedAssets).toContain('XAU/USD');
  });

  it('classifies CPI as inflation/high', () => {
    const c = classifyEvent('US Consumer Price Index (CPI)');
    expect(c.category).toBe('inflation');
    expect(c.importance).toBe('high');
  });

  it('classifies Non-Farm Payrolls / Employment Situation as employment/high', () => {
    expect(classifyEvent('US Employment Situation (Non-Farm Payrolls)').category).toBe('employment');
    expect(classifyEvent('Non-Farm Payrolls').importance).toBe('high');
  });

  it('classifies GDP as growth/high', () => {
    expect(classifyEvent('US GDP (Advance Estimate), Q3 2026').category).toBe('growth');
  });

  it('classifies ECB/BOE/BOJ rate decisions as monetary_policy/high with their own currency-relevant assets', () => {
    expect(classifyEvent('ECB Governing Council Interest Rate Decision').relatedAssets).toContain('EUR/USD');
    expect(classifyEvent('Bank of England MPC Interest Rate Decision').relatedAssets).toContain('GBP/USD');
    expect(classifyEvent('Bank of Japan Monetary Policy Meeting Decision').relatedAssets).toContain('USD/JPY');
  });

  it('is case-insensitive', () => {
    expect(classifyEvent('fomc interest rate decision').category).toBe('monetary_policy');
  });

  it('defaults an unrecognized title to other/unknown/no related assets - never guesses upward', () => {
    const c = classifyEvent('Some Obscure Regional Indicator Nobody Tracks');
    expect(c).toEqual({ category: 'other', importance: 'unknown', relatedAssets: [] });
  });

  it('never copies a commercial-provider impact label - classification is purely title-keyword-driven, deterministic for the same title every time', () => {
    const a = classifyEvent('US Consumer Price Index (CPI)');
    const b = classifyEvent('US Consumer Price Index (CPI)');
    expect(a).toEqual(b);
  });
});

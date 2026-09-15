import type { EventImportance } from './types';

/**
 * MKR-owned event classification - deterministic keyword matching against
 * an event's title, never a copied commercial-provider "impact"/analysis
 * label (task constraint: "Do not copy commercial-provider impact labels
 * or analysis. Do not implement buy/sell signals or AI analysis"). Pure
 * function, fully unit-testable, same rules for every provider (curated or
 * future live ones) so classification is consistent regardless of source.
 *
 * Rules are ordered most-specific-first and the first match wins - a title
 * containing multiple keywords (rare) still gets one deterministic answer
 * rather than an ambiguous merge.
 */

export interface EventClassification {
  category: string;
  importance: EventImportance;
  relatedAssets: string[];
}

interface Rule {
  category: string;
  importance: EventImportance;
  relatedAssets: string[];
  /** Matched case-insensitively against the title; ANY keyword matching triggers this rule. */
  keywords: string[];
}

// MKR's internal symbols (see schema.sql) referenced by relatedAssets -
// intentionally only symbols this catalog actually carries, never assumed.
const RULES: Rule[] = [
  {
    category: 'monetary_policy',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'SPX', 'NDX', 'DJI', 'EUR/USD', 'GBP/USD', 'USD/JPY'],
    keywords: ['fomc', 'federal open market committee', 'fed interest rate', 'federal funds rate'],
  },
  {
    category: 'monetary_policy',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'EUR/USD'],
    keywords: ['ecb interest rate', 'ecb rate decision', 'ecb monetary policy', 'governing council'],
  },
  {
    category: 'monetary_policy',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'GBP/USD'],
    keywords: ['boe interest rate', 'boe rate decision', 'bank of england', 'mpc'],
  },
  {
    category: 'monetary_policy',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'USD/JPY'],
    keywords: ['boj interest rate', 'boj rate decision', 'bank of japan', 'mpm', 'monetary policy meeting'],
  },
  {
    category: 'employment',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'SPX', 'NDX', 'DJI', 'EUR/USD', 'GBP/USD', 'USD/JPY'],
    keywords: ['non-farm payrolls', 'nonfarm payrolls', 'nfp', 'employment situation', 'unemployment rate'],
  },
  {
    category: 'inflation',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'SPX', 'NDX', 'DJI', 'EUR/USD', 'GBP/USD', 'USD/JPY'],
    keywords: ['consumer price index', 'cpi', 'core pce', 'pce price index', 'producer price index', 'ppi'],
  },
  {
    category: 'growth',
    importance: 'high',
    relatedAssets: ['XAU/USD', 'SPX', 'NDX', 'DJI'],
    keywords: ['gross domestic product', 'gdp'],
  },
  {
    category: 'trade',
    importance: 'medium',
    relatedAssets: ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY'],
    keywords: ['trade balance', 'current account'],
  },
  {
    category: 'manufacturing',
    importance: 'medium',
    relatedAssets: ['SPX', 'NDX', 'DJI'],
    keywords: ['pmi', 'purchasing managers', 'ism manufacturing', 'industrial production'],
  },
  {
    category: 'consumer',
    importance: 'medium',
    relatedAssets: ['SPX', 'NDX', 'DJI'],
    keywords: ['retail sales', 'consumer confidence', 'consumer sentiment'],
  },
  {
    category: 'housing',
    importance: 'low',
    relatedAssets: ['SPX', 'DJI'],
    keywords: ['housing starts', 'building permits', 'home sales', 'housing price'],
  },
];

const DEFAULT_CLASSIFICATION: EventClassification = { category: 'other', importance: 'unknown', relatedAssets: [] };

export function classifyEvent(title: string): EventClassification {
  const lower = title.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return { category: rule.category, importance: rule.importance, relatedAssets: rule.relatedAssets };
    }
  }
  return DEFAULT_CLASSIFICATION;
}

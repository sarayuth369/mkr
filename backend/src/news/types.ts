// Provider-neutral normalized shape for News Radar's provider client
// (finnhub-parser.ts) - the client is responsible for mapping its own
// response shape into this, never the other way around. Economic
// Calendar has its own canonical model - see src/calendar/types.ts.

export interface NormalizedNewsArticle {
  id: string;
  headline: string;
  source: string;
  timestamp: number; // epoch ms
  category: string;
  impact: 'high' | 'medium' | 'low';
  affectedAssets: string[];
  summary: string;
}

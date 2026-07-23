import type { MarketOverview, SectorRotationData } from '@/types';

export type SectorIndex = 'sp500' | 'ftse100';

export interface TreemapItem {
  name: string;
  value: number;
  pct: number;
  [key: string]: unknown;
}

// Approximate market-cap weights by index (source: SPDR / iShares, rounded)
const SP500_WEIGHTS: Record<string, number> = {
  Technology: 29,
  Financials: 13,
  'Health Care': 12,
  'Consumer Discretionary': 10,
  Industrials: 9,
  'Communication Services': 8,
  'Consumer Staples': 6,
  Energy: 4,
  'Real Estate': 2.5,
  Materials: 2.5,
  Utilities: 2.5,
};

const FTSE_WEIGHTS: Record<string, number> = {
  Financials: 18,
  'Consumer Staples': 14,
  'Health Care': 12,
  Industrials: 11,
  'Consumer Discretionary': 10,
  Energy: 10,
  Materials: 9,
  'Communication Services': 5,
  Technology: 4,
  Utilities: 4,
  'Real Estate': 3,
};

// Normalise rotation sector names to the weight-map names
const ROTATION_TO_WEIGHT: Record<string, string> = {
  'Consumer Disc.': 'Consumer Discretionary',
  'Comm. Services': 'Communication Services',
};

function normSector(s: string): string {
  return ROTATION_TO_WEIGHT[s] ?? s;
}

// Pure, recharts-free — deliberately kept out of SectorTreemapView.tsx so the
// caller can decide whether there's anything to plot *before* triggering the
// dynamic import of the chart itself (see SectorRotationHeatmap.tsx). Without
// this split, `view === 'today'` (the default) would render <TreemapView>
// unconditionally — including for its own "No data" branch — which still
// pulls in the full recharts chunk just to show two words of text.
export function computeSectorTreeData(
  activeIndex: SectorIndex,
  rotationData: SectorRotationData | undefined,
  overviewData: MarketOverview | undefined,
): TreemapItem[] {
  const weights = activeIndex === 'ftse100' ? FTSE_WEIGHTS : SP500_WEIGHTS;
  const pctMap = new Map<string, number>();
  if (rotationData?.rows.length && rotationData.dates.length) {
    const lastIdx = rotationData.dates.length - 1;
    for (const row of rotationData.rows) {
      pctMap.set(normSector(row.sector), row.changes[lastIdx] ?? 0);
    }
  } else if (activeIndex === 'sp500' && overviewData?.sectors.length) {
    for (const s of overviewData.sectors) {
      pctMap.set(s.sector, s.changesPercentage);
    }
  }
  return Object.entries(weights)
    .map(([name, value]) => ({ name, value, pct: pctMap.get(name) ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

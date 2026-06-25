export interface MockOHLCVBar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: string;
}

export function makeMinuteBars(count: number, symbol = 'NVDA'): MockOHLCVBar[] {
  const bars: MockOHLCVBar[] = [];
  const base = new Date('2024-01-15T14:30:00.000Z'); // market open (UTC)
  for (let i = 0; i < count; i++) {
    const ts = new Date(base.getTime() + i * 60_000);
    const close = 500 + Math.sin(i / 10) * 10;
    bars.push({
      symbol,
      timestamp: ts.toISOString(),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10_000 + i * 100,
      interval: '1m',
    });
  }
  return bars;
}

export function makeDailyBars(count: number, symbol = 'NVDA'): MockOHLCVBar[] {
  const bars: MockOHLCVBar[] = [];
  // Use a fixed base date; the chart only needs unique YYYY-MM-DD keys
  const base = new Date('2023-01-03T14:30:00.000Z');
  for (let i = 0; i < count; i++) {
    const ts = new Date(base.getTime() + i * 86_400_000);
    const close = 300 + i * 0.5;
    bars.push({
      symbol,
      timestamp: ts.toISOString(),
      open: close - 2,
      high: close + 3,
      low: close - 3,
      close,
      volume: 50_000_000 + i * 1_000_000,
      interval: '1d',
    });
  }
  return bars;
}

// Adds a T00 duplicate for every bar, simulating the MongoDB duplicate-UTC-offset bug.
// The frontend dedup should collapse these before passing data to the chart.
export function makeDailyBarsWithDuplicates(count: number, symbol = 'NVDA'): MockOHLCVBar[] {
  const clean = makeDailyBars(count, symbol);
  const withDups: MockOHLCVBar[] = [];
  for (const bar of clean) {
    withDups.push(bar);
    const ts00 = new Date(bar.timestamp);
    ts00.setUTCHours(0, 0, 0, 0);
    withDups.push({ ...bar, timestamp: ts00.toISOString(), close: bar.close - 1 });
  }
  return withDups;
}

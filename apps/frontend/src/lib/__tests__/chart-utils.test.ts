import { toTime, sortBars, computeMA, computeRSI } from '../chart-utils';
import type { OHLCVBar } from '@/types';

function makeBar(timestamp: string, close: number, extra: Partial<OHLCVBar> = {}): OHLCVBar {
  return {
    symbol: 'TEST',
    interval: '1d',
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    ...extra,
  };
}

describe('toTime', () => {
  it('returns YYYY-MM-DD string for daily bars', () => {
    expect(toTime('2024-03-15T00:00:00.000Z', true)).toBe('2024-03-15');
  });

  it('returns Unix seconds (number) for intraday bars', () => {
    const ts = '2024-03-15T14:30:00.000Z';
    const expected = Math.floor(new Date(ts).getTime() / 1000);
    expect(toTime(ts, false)).toBe(expected);
  });

  it('truncates intraday sub-second precision', () => {
    const ts = '2024-03-15T14:30:00.999Z';
    const result = toTime(ts, false) as number;
    expect(result % 1).toBe(0);
  });
});

describe('sortBars', () => {
  it('sorts bars in ascending timestamp order', () => {
    const bars = [makeBar('2024-03-15', 100), makeBar('2024-03-13', 98), makeBar('2024-03-14', 99)];
    const sorted = sortBars(bars);
    expect(sorted.map((b) => b.timestamp)).toEqual(['2024-03-13', '2024-03-14', '2024-03-15']);
  });

  it('does not mutate the original array', () => {
    const bars = [makeBar('2024-03-15', 100), makeBar('2024-03-13', 98)];
    const original = [...bars];
    sortBars(bars);
    expect(bars).toEqual(original);
  });

  it('returns a new array instance', () => {
    const bars = [makeBar('2024-03-14', 99)];
    expect(sortBars(bars)).not.toBe(bars);
  });
});

describe('computeMA', () => {
  const bars = [
    makeBar('2024-01-01', 10),
    makeBar('2024-01-02', 20),
    makeBar('2024-01-03', 30),
    makeBar('2024-01-04', 40),
    makeBar('2024-01-05', 50),
  ];

  describe('SMA', () => {
    it('returns empty array when bars < period', () => {
      expect(computeMA(bars.slice(0, 2), 'sma', 3, true)).toEqual([]);
    });

    it('returns correct number of values: bars.length - period + 1', () => {
      const result = computeMA(bars, 'sma', 3, true);
      expect(result).toHaveLength(bars.length - 3 + 1); // 3 values
    });

    it('computes correct SMA values', () => {
      const result = computeMA(bars, 'sma', 3, true);
      // SMA(3): avg of [10,20,30]=20, [20,30,40]=30, [30,40,50]=40
      expect(result.map((r) => r.value)).toEqual([20, 30, 40]);
    });

    it('aligns first value to bar at index period-1', () => {
      const result = computeMA(bars, 'sma', 3, true);
      // First MA value corresponds to bars[2] (index 2 = period-1)
      expect(result[0]?.time).toBe('2024-01-03');
    });

    it('aligns last value to the final bar', () => {
      const result = computeMA(bars, 'sma', 3, true);
      expect(result[result.length - 1]?.time).toBe('2024-01-05');
    });
  });

  describe('EMA', () => {
    it('returns empty array when bars < period', () => {
      expect(computeMA(bars.slice(0, 1), 'ema', 3, true)).toEqual([]);
    });

    it('returns correct number of values: bars.length - period + 1', () => {
      const result = computeMA(bars, 'ema', 3, true);
      expect(result).toHaveLength(bars.length - 3 + 1);
    });

    it('first EMA value equals the SMA seed (average of first period bars)', () => {
      const result = computeMA(bars, 'ema', 3, true);
      // EMA seed = SMA of first 3 bars = (10+20+30)/3 = 20
      expect(result[0]?.value).toBeCloseTo(20, 5);
    });

    it('aligns first value to bar at index period-1', () => {
      const result = computeMA(bars, 'ema', 3, true);
      expect(result[0]?.time).toBe('2024-01-03');
    });
  });

  describe('intraday time alignment', () => {
    it('returns Unix second timestamps for intraday bars', () => {
      const intradayBars = [
        makeBar('2024-01-01T09:30:00.000Z', 100),
        makeBar('2024-01-01T09:31:00.000Z', 101),
        makeBar('2024-01-01T09:32:00.000Z', 102),
      ];
      const result = computeMA(intradayBars, 'sma', 2, false);
      const expected = Math.floor(new Date('2024-01-01T09:31:00.000Z').getTime() / 1000);
      expect(result[0]?.time).toBe(expected);
    });
  });
});

describe('computeRSI', () => {
  // period consecutive rising closes guarantee RS = ∞ → RSI = 100
  function risingBars(count: number): OHLCVBar[] {
    return Array.from({ length: count }, (_, i) =>
      makeBar(new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), 100 + i),
    );
  }

  // period consecutive falling closes guarantee RS = 0 → RSI = 0
  function fallingBars(count: number): OHLCVBar[] {
    return Array.from({ length: count }, (_, i) =>
      makeBar(new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), 100 - i),
    );
  }

  it('returns empty array when bars.length <= period', () => {
    expect(computeRSI(risingBars(14), 14, true)).toEqual([]);
    expect(computeRSI([], 14, true)).toEqual([]);
  });

  it('returns 1 value when bars.length === period + 1', () => {
    expect(computeRSI(risingBars(15), 14, true)).toHaveLength(1);
  });

  it('returns bars.length - period values', () => {
    expect(computeRSI(risingBars(20), 14, true)).toHaveLength(6);
  });

  it('aligns first value to bar at index period (not period - 1 like MA)', () => {
    const bars = risingBars(20);
    const result = computeRSI(bars, 14, true);
    // bar index 14 = 2024-01-15
    expect(result[0]?.time).toBe('2024-01-15');
  });

  it('aligns last value to the final bar', () => {
    const bars = risingBars(20);
    const result = computeRSI(bars, 14, true);
    expect(result[result.length - 1]?.time).toBe('2024-01-20');
  });

  it('returns 100 for all-rising prices (no losing periods)', () => {
    // Use period=2 for a simple, hand-verifiable case
    const result = computeRSI(risingBars(5), 2, true);
    expect(result.length).toBeGreaterThan(0);
    for (const { value } of result) {
      expect(value).toBe(100);
    }
  });

  it('returns 0 for all-falling prices (no gaining periods)', () => {
    const result = computeRSI(fallingBars(5), 2, true);
    expect(result.length).toBeGreaterThan(0);
    for (const { value } of result) {
      expect(value).toBe(0);
    }
  });

  it('all output values are in the [0, 100] range for mixed market data', () => {
    const mixedBars = Array.from({ length: 30 }, (_, i) =>
      makeBar(
        new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
        100 + Math.sin(i) * 20,
      ),
    );
    const result = computeRSI(mixedBars, 14, true);
    expect(result.length).toBeGreaterThan(0);
    for (const { value } of result) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('returns Unix second timestamps for intraday bars', () => {
    const intradayBars = Array.from({ length: 5 }, (_, i) =>
      makeBar(new Date(Date.UTC(2024, 0, 1, 9, 30 + i)).toISOString(), 100 + i),
    );
    // period=2: first output aligns to bars[2] = 09:32 UTC
    const result = computeRSI(intradayBars, 2, false);
    const expected = Math.floor(new Date('2024-01-01T09:32:00.000Z').getTime() / 1000);
    expect(result[0]?.time).toBe(expected);
  });
});

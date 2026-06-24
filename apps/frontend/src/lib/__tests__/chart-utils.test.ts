import { toTime, sortBars, computeMA } from '../chart-utils';
import type { OHLCVBar } from '@/types';

function makeBar(timestamp: string, close: number, extra: Partial<OHLCVBar> = {}): OHLCVBar {
  return { timestamp, open: close, high: close, low: close, close, volume: 1000, ...extra };
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

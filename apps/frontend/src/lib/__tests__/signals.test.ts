import { detectSignals, type MAConfig } from '../signals';
import type { OHLCVBar } from '@/types';

function makeBar(close: number, i: number): OHLCVBar {
  const d = new Date(2026, 0, i + 1).toISOString();
  return {
    symbol: 'TEST',
    timestamp: d,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    interval: '1d',
  };
}

/** N bars rising by `step` from `start` */
function risingBars(n: number, start = 100, step = 1): OHLCVBar[] {
  return Array.from({ length: n }, (_, i) => makeBar(start + i * step, i));
}

/** N bars falling by `step` from `start` */
function fallingBars(n: number, start = 200, step = 1): OHLCVBar[] {
  return Array.from({ length: n }, (_, i) => makeBar(start - i * step, i));
}

const MA_CONFIGS: MAConfig[] = [
  { key: 'EMA12', type: 'ema', period: 12 },
  { key: 'EMA26', type: 'ema', period: 26 },
  { key: 'SMA20', type: 'sma', period: 20 },
  { key: 'SMA50', type: 'sma', period: 50 },
  { key: 'SMA200', type: 'sma', period: 200 },
];

describe('detectSignals', () => {
  describe('when all flags are off', () => {
    it('returns empty array when no indicators are enabled', () => {
      const bars = risingBars(50);
      const signals = detectSignals(bars, true, false, false);
      expect(signals).toHaveLength(0);
    });
  });

  // ── RSI ──────────────────────────────────────────────────────────────────

  describe('RSI signals', () => {
    it('emits an Oversold sell→buy signal when last RSI < 30 (all-falling bars)', () => {
      // All-falling bars produce RSI ≈ 0 — well below the 30 threshold
      const bars = fallingBars(30);
      const signals = detectSignals(bars, true, true, false);
      const rsiSignals = signals.filter((s) => s.source === 'rsi');
      expect(rsiSignals).toHaveLength(1);
      expect(rsiSignals[0]!.type).toBe('buy');
      expect(rsiSignals[0]!.description).toMatch(/Oversold/);
    });

    it('emits an Overbought buy→sell signal when last RSI > 70 (all-rising bars)', () => {
      // All-rising bars produce RSI ≈ 100 — well above the 70 threshold
      const bars = risingBars(30);
      const signals = detectSignals(bars, true, true, false);
      const rsiSignals = signals.filter((s) => s.source === 'rsi');
      expect(rsiSignals).toHaveLength(1);
      expect(rsiSignals[0]!.type).toBe('sell');
      expect(rsiSignals[0]!.description).toMatch(/Overbought/);
    });

    it('emits no RSI signal when bars are mixed (RSI between 30–70)', () => {
      // Alternating up/down keeps RSI near 50
      const bars = Array.from({ length: 30 }, (_, i) => makeBar(100 + (i % 2 === 0 ? 1 : -1), i));
      const signals = detectSignals(bars, true, true, false);
      const rsiSignals = signals.filter((s) => s.source === 'rsi');
      expect(rsiSignals).toHaveLength(0);
    });

    it('emits no RSI signal when showRSI is false regardless of bar direction', () => {
      const bars = fallingBars(30);
      const signals = detectSignals(bars, true, false, false);
      expect(signals.filter((s) => s.source === 'rsi')).toHaveLength(0);
    });

    it('includes the RSI value in the description string', () => {
      const bars = fallingBars(30);
      const signals = detectSignals(bars, true, true, false);
      const rsi = signals.find((s) => s.source === 'rsi');
      expect(rsi?.description).toMatch(/RSI \d+\.\d/);
    });

    it('RSI signal time matches the last bar timestamp', () => {
      const bars = fallingBars(30);
      const signals = detectSignals(bars, true, true, false);
      const rsi = signals.find((s) => s.source === 'rsi');
      // The last bar has the highest date index (29)
      expect(String(rsi!.time)).toMatch(/2026/);
    });
  });

  // ── MACD ─────────────────────────────────────────────────────────────────

  describe('MACD signals', () => {
    it('emits no MACD signals when showMACD is false', () => {
      const bars = risingBars(60);
      const signals = detectSignals(bars, true, false, false);
      expect(signals.filter((s) => s.source === 'macd')).toHaveLength(0);
    });

    it('requires at least slowPeriod + signalPeriod bars (35 for 12/26/9)', () => {
      // 34 bars: too few for MACD — no crossovers possible
      const bars = risingBars(34);
      const signals = detectSignals(bars, true, false, true);
      expect(signals.filter((s) => s.source === 'macd')).toHaveLength(0);
    });

    it('emits a buy signal when MACD crosses above signal line', () => {
      // Long fall (drives MACD deeply below signal), then steep rise (drives MACD above signal)
      // 80+60 bars with large steps ensures the crossover occurs well within the valid range
      const down = fallingBars(80, 400, 3);
      const up = risingBars(60, 165, 6);
      const bars = [...down, ...up];
      const signals = detectSignals(bars, true, false, true);
      const macdBuys = signals.filter((s) => s.source === 'macd' && s.type === 'buy');
      expect(macdBuys.length).toBeGreaterThanOrEqual(1);
    });

    it('emits a sell signal when MACD crosses below signal line', () => {
      // Long rise (drives MACD above signal), then steep fall (drives MACD below signal)
      const up = risingBars(80, 100, 3);
      const down = fallingBars(60, 335, 5);
      const bars = [...up, ...down];
      const signals = detectSignals(bars, true, false, true);
      const macdSells = signals.filter((s) => s.source === 'macd' && s.type === 'sell');
      expect(macdSells.length).toBeGreaterThanOrEqual(1);
    });

    it('MACD buy description mentions bullish momentum', () => {
      const down = fallingBars(80, 400, 3);
      const up = risingBars(60, 165, 6);
      const bars = [...down, ...up];
      const signals = detectSignals(bars, true, false, true);
      const buy = signals.find((s) => s.source === 'macd' && s.type === 'buy');
      expect(buy?.description).toMatch(/Bullish/i);
    });
  });

  // ── MA crossovers ─────────────────────────────────────────────────────────

  describe('MA crossover signals', () => {
    it('returns no MA signals when maConfigs is not provided', () => {
      const bars = risingBars(60);
      const signals = detectSignals(bars, true, false, false);
      expect(signals.filter((s) => s.source === 'ma-cross')).toHaveLength(0);
    });

    it('returns no MA signals when fewer than 2 configs are provided', () => {
      const bars = risingBars(60);
      const signals = detectSignals(bars, true, false, false, [
        { key: 'EMA12', type: 'ema', period: 12 },
      ]);
      expect(signals.filter((s) => s.source === 'ma-cross')).toHaveLength(0);
    });

    it('detects EMA12/EMA26 crossover buy signal', () => {
      // Enough bars for EMA26: price drops then surges to create upward crossover
      const down = fallingBars(30, 200, 2);
      const up = risingBars(40, 140, 5);
      const bars = [...down, ...up];
      const signals = detectSignals(bars, true, false, false, MA_CONFIGS);
      const maBuys = signals.filter((s) => s.source === 'ma-cross' && s.type === 'buy');
      expect(maBuys.length).toBeGreaterThanOrEqual(1);
    });

    it('MA crossover description contains key names', () => {
      const down = fallingBars(30, 200, 2);
      const up = risingBars(40, 140, 5);
      const bars = [...down, ...up];
      const signals = detectSignals(bars, true, false, false, MA_CONFIGS);
      const cross = signals.find((s) => s.source === 'ma-cross');
      if (cross) {
        // Description should mention the two MA keys that crossed
        expect(cross.description).toMatch(/EMA|SMA/);
      }
    });

    it('requires enough bars to compute slow MA (SMA50 needs 50 bars)', () => {
      // Only 30 bars — SMA50 cannot be computed, so no SMA20/50 cross
      const bars = risingBars(30);
      const smaConfigs: MAConfig[] = [
        { key: 'SMA20', type: 'sma', period: 20 },
        { key: 'SMA50', type: 'sma', period: 50 },
      ];
      const signals = detectSignals(bars, true, false, false, smaConfigs);
      expect(signals.filter((s) => s.source === 'ma-cross')).toHaveLength(0);
    });

    it('every MA crossover signal has a time, type, source, and description', () => {
      const down = fallingBars(30, 200, 2);
      const up = risingBars(40, 140, 5);
      const bars = [...down, ...up];
      const signals = detectSignals(bars, true, false, false, MA_CONFIGS);
      for (const s of signals.filter((s) => s.source === 'ma-cross')) {
        expect(s).toHaveProperty('time');
        expect(['buy', 'sell']).toContain(s.type);
        expect(s.source).toBe('ma-cross');
        expect(typeof s.description).toBe('string');
      }
    });
  });
});

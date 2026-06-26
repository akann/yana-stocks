import { SMA, EMA, RSI, MACD } from 'technicalindicators';
import type { Time } from 'lightweight-charts';
import type { OHLCVBar } from '@/types';

export function toTime(timestamp: string, isDaily: boolean): Time {
  if (isDaily) return timestamp.slice(0, 10) as Time;
  return Math.floor(new Date(timestamp).getTime() / 1000) as Time;
}

export function sortBars(bars: OHLCVBar[]): OHLCVBar[] {
  return [...bars].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function computeMA(
  bars: OHLCVBar[],
  type: 'sma' | 'ema',
  period: number,
  isDaily: boolean,
): { time: Time; value: number }[] {
  if (bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const values =
    type === 'sma'
      ? SMA.calculate({ period, values: closes })
      : EMA.calculate({ period, values: closes });
  const offset = period - 1;
  // bars[offset + i] is always defined: values.length === bars.length - period + 1
  return values.map((v, i) => ({ time: toTime(bars[offset + i]!.timestamp, isDaily), value: v }));
}

export interface MACDData {
  macdLine: { time: Time; value: number }[];
  signalLine: { time: Time; value: number }[];
  histogram: { time: Time; value: number; color: string }[];
}

// MACD result offset = slowPeriod - 1. The first signalPeriod - 1 results lack
// signal/histogram, so we only emit entries where all three fields are defined —
// this keeps macdLine, signalLine, and histogram exactly parallel (same length,
// same time keys), which prevents lightweight-charts ensureNotNull crashes when
// two LineSeries on the same priceScaleId have misaligned time ranges.
export function computeMACD(
  bars: OHLCVBar[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  isDaily: boolean,
): MACDData {
  if (bars.length < slowPeriod + signalPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }
  const closes = bars.map((b) => b.close);
  const results = MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const offset = slowPeriod - 1;
  const macdLine: { time: Time; value: number }[] = [];
  const signalLine: { time: Time; value: number }[] = [];
  const histogram: { time: Time; value: number; color: string }[] = [];

  results.forEach((r, i) => {
    if (r.MACD === undefined || r.signal === undefined || r.histogram === undefined) return;
    const time = toTime(bars[offset + i]!.timestamp, isDaily);
    macdLine.push({ time, value: r.MACD });
    signalLine.push({ time, value: r.signal });
    histogram.push({
      time,
      value: r.histogram,
      color: r.histogram >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)',
    });
  });

  return { macdLine, signalLine, histogram };
}

// RSI needs period+1 values to produce the first output point; offset = period.
// values.length === bars.length - period, so bars[period + i] is always defined.
export function computeRSI(
  bars: OHLCVBar[],
  period: number,
  isDaily: boolean,
): { time: Time; value: number }[] {
  if (bars.length <= period) return [];
  const closes = bars.map((b) => b.close);
  const values = RSI.calculate({ period, values: closes });
  return values.map((v, i) => ({ time: toTime(bars[period + i]!.timestamp, isDaily), value: v }));
}

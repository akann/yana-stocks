import { SMA, EMA } from 'technicalindicators';
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

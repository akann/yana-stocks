import type { Time } from 'lightweight-charts';
import { computeMA, computeRSI, computeMACD } from './chart-utils';
import type { OHLCVBar } from '@/types';

export interface MAConfig {
  key: string;
  type: 'sma' | 'ema';
  period: number;
}

// Pairs checked for crossovers, fast MA first
const MA_CROSSOVER_PAIRS: [string, string][] = [
  ['EMA12', 'EMA26'],
  ['SMA20', 'SMA50'],
  ['SMA50', 'SMA200'],
];

export interface ChartSignal {
  time: Time;
  type: 'buy' | 'sell';
  source: 'ma-cross' | 'rsi' | 'macd';
  description: string;
}

export function detectSignals(
  bars: OHLCVBar[],
  isDaily: boolean,
  showRSI: boolean,
  showMACD: boolean,
  maConfigs?: MAConfig[],
): ChartSignal[] {
  const signals: ChartSignal[] = [];

  if (showRSI) {
    const rsiData = computeRSI(bars, 14, isDaily);
    const last = rsiData[rsiData.length - 1];
    if (last !== undefined) {
      if (last.value > 70) {
        signals.push({
          time: last.time,
          type: 'sell',
          source: 'rsi',
          description: `RSI ${last.value.toFixed(1)} — Overbought`,
        });
      } else if (last.value < 30) {
        signals.push({
          time: last.time,
          type: 'buy',
          source: 'rsi',
          description: `RSI ${last.value.toFixed(1)} — Oversold`,
        });
      }
    }
  }

  if (showMACD) {
    const { macdLine, signalLine } = computeMACD(bars, 12, 26, 9, isDaily);
    const n = signalLine.length;
    if (n >= 2) {
      const prevMACD = macdLine[n - 2]!.value;
      const prevSig = signalLine[n - 2]!.value;
      const currMACD = macdLine[n - 1]!.value;
      const currSig = signalLine[n - 1]!.value;
      const time = macdLine[n - 1]!.time;

      if (prevMACD <= prevSig && currMACD > currSig) {
        signals.push({
          time,
          type: 'buy',
          source: 'macd',
          description: 'MACD crossed above signal — Bullish momentum',
        });
      } else if (prevMACD >= prevSig && currMACD < currSig) {
        signals.push({
          time,
          type: 'sell',
          source: 'macd',
          description: 'MACD crossed below signal — Bearish momentum',
        });
      }
    }
  }

  if (maConfigs && maConfigs.length >= 2) {
    const maDataMap = new Map<string, { time: Time; value: number }[]>();
    for (const cfg of maConfigs) {
      const data = computeMA(bars, cfg.type, cfg.period, isDaily);
      if (data.length > 0) maDataMap.set(cfg.key, data);
    }

    for (const [fastKey, slowKey] of MA_CROSSOVER_PAIRS) {
      const fast = maDataMap.get(fastKey);
      const slow = maDataMap.get(slowKey);
      if (!fast || !slow || fast.length < 2 || slow.length < 2) continue;

      const currFast = fast[fast.length - 1]!.value;
      const currSlow = slow[slow.length - 1]!.value;
      const prevFast = fast[fast.length - 2]!.value;
      const prevSlow = slow[slow.length - 2]!.value;
      const time = fast[fast.length - 1]!.time;

      if (prevFast <= prevSlow && currFast > currSlow) {
        signals.push({
          time,
          type: 'buy',
          source: 'ma-cross',
          description: `${fastKey} crossed above ${slowKey}`,
        });
      } else if (prevFast >= prevSlow && currFast < currSlow) {
        signals.push({
          time,
          type: 'sell',
          source: 'ma-cross',
          description: `${fastKey} crossed below ${slowKey}`,
        });
      }
    }
  }

  return signals;
}

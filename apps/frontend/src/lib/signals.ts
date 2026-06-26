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
    // Only emit RSI signals for the most recent bar (current state)
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
    // Scan all bars for MACD crossovers so arrows appear throughout the chart
    for (let i = 1; i < n; i++) {
      const prevMACD = macdLine[i - 1]!.value;
      const prevSig = signalLine[i - 1]!.value;
      const currMACD = macdLine[i]!.value;
      const currSig = signalLine[i]!.value;
      const time = macdLine[i]!.time;

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

      // Align arrays by time — fast (EMA12) has fewer leading values than slow (EMA26)
      const slowMap = new Map(slow.map((p) => [String(p.time), p.value]));
      for (let i = 1; i < fast.length; i++) {
        const currTime = String(fast[i]!.time);
        const prevTime = String(fast[i - 1]!.time);
        const currFast = fast[i]!.value;
        const prevFast = fast[i - 1]!.value;
        const currSlow = slowMap.get(currTime);
        const prevSlow = slowMap.get(prevTime);
        if (currSlow === undefined || prevSlow === undefined) continue;

        if (prevFast <= prevSlow && currFast > currSlow) {
          signals.push({
            time: fast[i]!.time,
            type: 'buy',
            source: 'ma-cross',
            description: `${fastKey} crossed above ${slowKey}`,
          });
        } else if (prevFast >= prevSlow && currFast < currSlow) {
          signals.push({
            time: fast[i]!.time,
            type: 'sell',
            source: 'ma-cross',
            description: `${fastKey} crossed below ${slowKey}`,
          });
        }
      }
    }
  }

  return signals;
}

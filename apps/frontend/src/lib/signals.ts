import type { OHLCVBar } from '@/types';
import { computeRSI, computeMACD } from './chart-utils';

export interface ChartSignal {
  type: 'buy' | 'sell';
  source: 'ma-cross' | 'rsi' | 'macd';
  description: string;
}

export function detectSignals(
  bars: OHLCVBar[],
  isDaily: boolean,
  showRSI: boolean,
  showMACD: boolean,
): ChartSignal[] {
  const signals: ChartSignal[] = [];

  if (showRSI) {
    const rsiData = computeRSI(bars, 14, isDaily);
    const lastRSI = rsiData[rsiData.length - 1]?.value;
    if (lastRSI !== undefined) {
      if (lastRSI > 70) {
        signals.push({
          type: 'sell',
          source: 'rsi',
          description: `RSI ${lastRSI.toFixed(1)} — Overbought`,
        });
      } else if (lastRSI < 30) {
        signals.push({
          type: 'buy',
          source: 'rsi',
          description: `RSI ${lastRSI.toFixed(1)} — Oversold`,
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

      if (prevMACD <= prevSig && currMACD > currSig) {
        signals.push({
          type: 'buy',
          source: 'macd',
          description: 'MACD crossed above signal — Bullish momentum',
        });
      } else if (prevMACD >= prevSig && currMACD < currSig) {
        signals.push({
          type: 'sell',
          source: 'macd',
          description: 'MACD crossed below signal — Bearish momentum',
        });
      }
    }
  }

  return signals;
}

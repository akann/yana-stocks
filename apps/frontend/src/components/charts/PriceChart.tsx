'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { api } from '@/lib/api';
import type { OHLCVBar } from '@/types';

const RANGES = [
  { label: '1H', limit: 60, interval: '1m' },
  { label: '1D', limit: 390, interval: '1m' },
  { label: '1W', limit: 5, interval: '1d' },
  { label: '1M', limit: 21, interval: '1d' },
  { label: '3M', limit: 63, interval: '1d' },
  { label: '1Y', limit: 252, interval: '1d' },
] as const;
type RangeLabel = (typeof RANGES)[number]['label'];

interface ChartPoint {
  time: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

function OHLCVTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartPoint | undefined;
  if (!d) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-lg">
      <div className="text-gray-400 mb-2 font-medium">{label}</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1">
        <span className="text-gray-400">Open</span>
        <span className="text-white text-right">${d.open.toFixed(2)}</span>
        <span className="text-gray-400">High</span>
        <span className="text-green-400 text-right">${d.high.toFixed(2)}</span>
        <span className="text-gray-400">Low</span>
        <span className="text-red-400 text-right">${d.low.toFixed(2)}</span>
        <span className="text-gray-400">Close</span>
        <span className="text-white text-right font-semibold">${d.close.toFixed(2)}</span>
        <span className="text-gray-400">Volume</span>
        <span className="text-gray-300 text-right">{(d.volume / 1_000).toFixed(0)}K</span>
      </div>
    </div>
  );
}

interface Props {
  symbol: string;
  currentPrice?: number | null;
}

export function PriceChart({ symbol, currentPrice }: Props): React.JSX.Element {
  const [range, setRange] = useState<RangeLabel>('1D');
  const activeRange = RANGES.find((r) => r.label === range)!;

  const { data, isLoading } = useQuery<OHLCVBar[]>({
    queryKey: ['history', symbol, activeRange.limit, activeRange.interval],
    queryFn: () =>
      api
        .get<
          OHLCVBar[]
        >(`/stocks/${symbol}/history?limit=${activeRange.limit}&interval=${activeRange.interval}`)
        .then((r) => r.data),
    refetchInterval: activeRange.interval === '1d' ? 3_600_000 : 30_000,
    staleTime: activeRange.interval === '1d' ? 1_800_000 : 10_000,
  });

  const { points, domain, isUp } = useMemo(() => {
    if (!data?.length)
      return { points: [], domain: ['auto', 'auto'] as ['auto', 'auto'], isUp: true };

    const sorted = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const isDaily = activeRange.interval === '1d';
    const pts: ChartPoint[] = sorted.map((bar) => ({
      time: isDaily
        ? new Date(bar.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : new Date(bar.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
      close: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
    }));

    const closes = pts.map((p) => p.close);
    const highs = sorted.map((b) => b.high);
    const lows = sorted.map((b) => b.low);
    const minLow = Math.min(...lows);
    const maxHigh = Math.max(...highs);
    const pad = (maxHigh - minLow) * 0.08;

    return {
      points: pts,
      domain: [parseFloat((minLow - pad).toFixed(2)), parseFloat((maxHigh + pad).toFixed(2))] as [
        number,
        number,
      ],
      isUp: (closes[closes.length - 1] ?? 0) >= (closes[0] ?? 0),
    };
  }, [data, activeRange.interval]);

  const strokeColor = isUp ? '#22c55e' : '#ef4444';
  const gradientId = `price-grad-${symbol}`;

  if (isLoading) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-80" />;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Price Chart
        </h3>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                range === r.label
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!points.length ? (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          No price history available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={272}>
          <AreaChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />

            <XAxis
              dataKey="time"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={domain}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={52}
            />

            <Tooltip content={<OHLCVTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />

            {currentPrice != null && (
              <ReferenceLine
                y={currentPrice}
                stroke="#3b82f6"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: `$${currentPrice.toFixed(2)}`,
                  position: 'insideBottomRight',
                  fill: '#3b82f6',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="close"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: strokeColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

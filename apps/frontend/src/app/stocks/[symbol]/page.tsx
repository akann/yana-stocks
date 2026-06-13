'use client';

import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NewsPanel } from '@/components/news/NewsPanel';
import { PriceChart } from '@/components/charts/PriceChart';
import { SignalsPanel } from '@/components/signals/SignalsPanel';
import type { OHLCVBar, StockAggregate } from '@/types';

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`font-semibold text-sm ${color ?? 'text-white'}`}>{value}</div>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export default function StockPage(): React.JSX.Element {
  const { symbol } = useParams<{ symbol: string }>();
  const upperSymbol = symbol.toUpperCase();

  const { data: stock, isLoading: priceLoading } = useQuery<StockAggregate>({
    queryKey: ['stock', upperSymbol],
    queryFn: () => api.get<StockAggregate>(`/stocks/${upperSymbol}`).then((r) => r.data),
    refetchInterval: 10_000,
  });

  // Fetch history for the day-stats row (shared with PriceChart's 1D query)
  const { data: history } = useQuery<OHLCVBar[]>({
    queryKey: ['history', upperSymbol, 390],
    queryFn: () =>
      api.get<OHLCVBar[]>(`/stocks/${upperSymbol}/history?limit=390`).then((r) => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dayStats = useMemo(() => {
    if (!history?.length) return null;
    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return {
      open: sorted[0]?.open ?? 0,
      high: sorted.reduce((m, b) => Math.max(m, b.high), -Infinity),
      low: sorted.reduce((m, b) => Math.min(m, b.low), Infinity),
      volume: sorted.reduce((s, b) => s + b.volume, 0),
    };
  }, [history]);

  const price = stock?.price ?? null;
  const change = stock?.change ?? null;
  const changePercent = stock?.changePercent ?? null;
  const isPositive = (changePercent ?? 0) >= 0;
  const changeColor = isPositive ? 'text-green-400' : 'text-red-400';

  return (
    <div className="space-y-6">
      {/* ── Live price header ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Price block */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{upperSymbol}</h1>
              {/* Animated live indicator */}
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
                </span>
                Live
              </span>
            </div>

            {priceLoading ? (
              <div className="animate-pulse h-9 w-40 bg-gray-800 rounded" />
            ) : price != null ? (
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-bold text-white tabular-nums">
                  ${price.toFixed(2)}
                </span>
                {change != null && changePercent != null && (
                  <span className={`text-base font-semibold ${changeColor}`}>
                    {isPositive ? '+' : ''}
                    {change.toFixed(2)}&nbsp;
                    <span className="text-sm font-medium">
                      ({isPositive ? '+' : ''}
                      {changePercent.toFixed(2)}%)
                    </span>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">
                No price data — run{' '}
                <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded">pnpm seed</code>
              </p>
            )}
          </div>

          {/* Day stats */}
          {dayStats && (
            <div className="flex flex-wrap gap-x-8 gap-y-3 sm:text-right">
              <Stat label="Open" value={`$${dayStats.open.toFixed(2)}`} />
              <Stat label="High" value={`$${dayStats.high.toFixed(2)}`} color="text-green-400" />
              <Stat label="Low" value={`$${dayStats.low.toFixed(2)}`} color="text-red-400" />
              <Stat label="Volume" value={formatVolume(dayStats.volume)} color="text-gray-300" />
            </div>
          )}
        </div>
      </div>

      {/* ── Chart + Signals ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PriceChart symbol={upperSymbol} currentPrice={price} />
        </div>
        <div>
          <SignalsPanel symbol={upperSymbol} />
        </div>
      </div>

      {/* ── News ── */}
      <NewsPanel symbol={upperSymbol} />
    </div>
  );
}

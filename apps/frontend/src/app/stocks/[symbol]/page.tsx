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
      <div className="text-gray-600 text-xs uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`font-semibold text-sm ${color ?? 'text-gray-900'}`}>{value}</div>
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

  // Intraday minute bars for live stocks (open, running high/low, cumulative volume)
  const { data: historyMin } = useQuery<OHLCVBar[]>({
    queryKey: ['history', upperSymbol, 390, '1m'],
    queryFn: () =>
      api
        .get<OHLCVBar[]>(`/stocks/${upperSymbol}/history?limit=390&interval=1m`)
        .then((r) => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  // Daily bars — fires immediately on page load to trigger on-demand Yahoo Finance fetch
  // before PriceChart mounts; also provides day stats for on-demand stocks
  const { data: historyDay } = useQuery<OHLCVBar[]>({
    queryKey: ['history', upperSymbol, 21, '1d'],
    queryFn: () =>
      api
        .get<OHLCVBar[]>(`/stocks/${upperSymbol}/history?limit=21&interval=1d`)
        .then((r) => r.data),
    staleTime: 300_000,
    retry: false,
  });

  const dayStats = useMemo(() => {
    if (historyMin?.length) {
      const sorted = [...historyMin].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      return {
        open: sorted[0]?.open ?? 0,
        high: sorted.reduce((m, b) => Math.max(m, b.high), -Infinity),
        low: sorted.reduce((m, b) => Math.min(m, b.low), Infinity),
        volume: sorted.reduce((s, b) => s + b.volume, 0),
      };
    }
    if (historyDay?.length) {
      const sorted = [...historyDay].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      const latest = sorted[sorted.length - 1]!;
      return {
        open: latest.open,
        high: latest.high,
        low: latest.low,
        volume: latest.volume,
      };
    }
    return null;
  }, [historyMin, historyDay]);

  const price = stock?.price ?? null;
  const change = stock?.change ?? null;
  const changePercent = stock?.changePercent ?? null;
  const isPositive = (changePercent ?? 0) >= 0;
  const changeColor = isPositive ? 'text-green-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* ── Live price header ── */}
      <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Price block */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{upperSymbol}</h1>
              {/* Animated live indicator */}
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
                </span>
                Live
              </span>
            </div>

            {priceLoading ? (
              <div className="animate-pulse h-9 w-40 bg-gray-100 rounded" />
            ) : price != null ? (
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-bold text-gray-900 tabular-nums">
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
              <p className="text-gray-600 text-sm">No price data available</p>
            )}
          </div>

          {/* Day stats */}
          {dayStats && (
            <div className="flex flex-wrap gap-x-8 gap-y-3 sm:text-right">
              <Stat label="Open" value={`$${dayStats.open.toFixed(2)}`} />
              <Stat label="High" value={`$${dayStats.high.toFixed(2)}`} color="text-green-600" />
              <Stat label="Low" value={`$${dayStats.low.toFixed(2)}`} color="text-red-600" />
              <Stat label="Volume" value={formatVolume(dayStats.volume)} color="text-gray-600" />
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

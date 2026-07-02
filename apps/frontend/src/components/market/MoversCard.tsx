'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { AddToWatchlistButton } from '@/components/watchlist/AddToWatchlistButton';
import type { MarketMovers, MoverEntry } from '@/types';

function MoverRow({ entry, rank }: { entry: MoverEntry; rank: number }): React.JSX.Element {
  const positive = entry.changePercent >= 0;
  return (
    <div className="flex items-center py-2 px-3 rounded-lg hover:bg-gray-100 transition-colors group">
      <Link href={`/stocks/${entry.symbol}`} className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-xs text-gray-600 w-4 shrink-0">{rank}</span>
        <span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors truncate">
          {entry.symbol}
        </span>
        <div className="ml-auto shrink-0 flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-900 tabular-nums">
            ${entry.price.toFixed(2)}
          </span>
          {/* Fixed width keeps the percent column (and thus the prices) aligned across rows */}
          <span
            className={clsx(
              'text-xs font-medium tabular-nums w-14 text-right',
              positive ? 'text-green-600' : 'text-red-600',
            )}
          >
            {positive ? '+' : ''}
            {entry.changePercent.toFixed(2)}%
          </span>
        </div>
      </Link>
      <div className="ml-1 shrink-0">
        <AddToWatchlistButton symbol={entry.symbol} />
      </div>
    </div>
  );
}

function formatLastUpdated(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${date}, ${time}`;
}

export function MoversCard(): React.JSX.Element {
  const { data, isLoading } = useQuery<MarketMovers>({
    queryKey: ['movers'],
    queryFn: () => api.get<MarketMovers>('/market/movers').then((r) => r.data),
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return <div className="animate-pulse bg-gray-100 rounded-xl h-64" />;
  }

  const lastUpdated = formatLastUpdated(data?.lastUpdated);

  return (
    <div className="space-y-1">
      {lastUpdated && (
        <p className="text-xs text-gray-400 text-right pr-1">
          <span className="font-medium text-gray-500">Updated:</span> {lastUpdated}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
            Top Gainers
          </h3>
          <div className="space-y-1">
            {(data?.gainers ?? []).map((entry, i) => (
              <MoverRow key={entry.symbol} entry={entry} rank={i + 1} />
            ))}
            {!data?.gainers?.length && (
              <p className="text-gray-600 text-sm py-4 text-center">No data</p>
            )}
          </div>
        </div>
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
            Top Losers
          </h3>
          <div className="space-y-1">
            {(data?.losers ?? []).map((entry, i) => (
              <MoverRow key={entry.symbol} entry={entry} rank={i + 1} />
            ))}
            {!data?.losers?.length && (
              <p className="text-gray-600 text-sm py-4 text-center">No data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

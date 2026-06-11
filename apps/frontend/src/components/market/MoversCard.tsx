'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import type { MarketMovers, MoverEntry } from '@/types';

function MoverRow({ entry, rank }: { entry: MoverEntry; rank: number }): React.JSX.Element {
  const positive = entry.changePercent >= 0;
  return (
    <Link
      href={`/stocks/${entry.symbol}`}
      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-800 transition-colors group"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 w-4">{rank}</span>
        <span className="font-medium text-white group-hover:text-blue-400 transition-colors">
          {entry.symbol}
        </span>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-white">${entry.price.toFixed(2)}</div>
        <div className={clsx('text-xs font-medium', positive ? 'text-green-400' : 'text-red-400')}>
          {positive ? '+' : ''}
          {entry.changePercent.toFixed(2)}%
        </div>
      </div>
    </Link>
  );
}

export function MoversCard(): React.JSX.Element {
  const { data, isLoading } = useQuery<MarketMovers>({
    queryKey: ['movers'],
    queryFn: () => api.get<MarketMovers>('/market/movers').then((r) => r.data),
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-64" />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Top Gainers
        </h3>
        <div className="space-y-1">
          {(data?.gainers ?? []).map((entry, i) => (
            <MoverRow key={entry.symbol} entry={entry} rank={i + 1} />
          ))}
          {!data?.gainers?.length && (
            <p className="text-gray-500 text-sm py-4 text-center">No data</p>
          )}
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Top Losers
        </h3>
        <div className="space-y-1">
          {(data?.losers ?? []).map((entry, i) => (
            <MoverRow key={entry.symbol} entry={entry} rank={i + 1} />
          ))}
          {!data?.losers?.length && (
            <p className="text-gray-500 text-sm py-4 text-center">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}

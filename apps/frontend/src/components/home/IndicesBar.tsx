'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isMarketOpen } from '@/lib/market-hours';
import type { MarketOverview } from '@/types';

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function IndicesBar(): React.JSX.Element {
  const { data, isLoading } = useQuery<MarketOverview>({
    queryKey: ['market-overview'],
    queryFn: () => api.get<MarketOverview>('/market/overview').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-5 bg-gray-200 rounded w-24 mb-1" />
            <div className="h-3 bg-gray-200 rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {data.indices.map((idx) => {
        const positive = idx.changesPercentage >= 0;
        const closed = !isMarketOpen(idx.symbol);
        return (
          <div key={idx.symbol} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500 font-medium truncate">{idx.name}</p>
              {closed && (
                <span className="shrink-0 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">
                  Closed
                </span>
              )}
            </div>
            <p className="text-lg font-bold text-gray-900 mt-0.5">{fmt(idx.price)}</p>
            <p
              className={`text-xs font-semibold mt-0.5 ${positive ? 'text-green-600' : 'text-red-600'}`}
            >
              {positive ? '+' : ''}
              {fmt(idx.change)} ({positive ? '+' : ''}
              {fmt(idx.changesPercentage)}%)
            </p>
          </div>
        );
      })}
    </div>
  );
}

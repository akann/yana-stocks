'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NewsPanel } from '@/components/news/NewsPanel';
import { PriceChart } from '@/components/charts/PriceChart';
import { SignalsPanel } from '@/components/signals/SignalsPanel';
import type { StockAggregate } from '@/types';

export default function StockPage(): React.JSX.Element {
  const { symbol } = useParams<{ symbol: string }>();
  const upperSymbol = symbol.toUpperCase();

  const { data: stock, isLoading } = useQuery<StockAggregate>({
    queryKey: ['stock', upperSymbol],
    queryFn: () => api.get<StockAggregate>(`/stocks/${upperSymbol}`).then((r) => r.data),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold text-white">{upperSymbol}</h1>
        {isLoading ? (
          <div className="animate-pulse bg-gray-800 rounded h-6 w-24" />
        ) : stock?.price != null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold text-white">${stock.price.toFixed(2)}</span>
            {stock.changePercent != null && (
              <span
                className={`text-sm font-medium ${stock.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}
              >
                {stock.changePercent >= 0 ? '+' : ''}
                {stock.changePercent.toFixed(2)}%
              </span>
            )}
          </div>
        ) : (
          <span className="text-gray-500 text-sm">No price data</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PriceChart symbol={upperSymbol} />
        </div>
        <div>
          <SignalsPanel symbol={upperSymbol} />
        </div>
      </div>

      <NewsPanel symbol={upperSymbol} />
    </div>
  );
}

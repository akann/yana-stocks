'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import type { AnalystRating } from '@/types';

function daysAgo(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function AnalystPanel({
  symbol,
  currentPrice,
}: {
  symbol: string;
  currentPrice: number | null;
}): React.JSX.Element {
  const { data, isLoading } = useQuery<AnalystRating>({
    queryKey: ['analyst', symbol],
    queryFn: () => api.get<AnalystRating>(`/stocks/${symbol}/analyst`).then((r) => r.data),
    staleTime: 3_600_000,
    retry: false,
  });

  const total = data?.analystCount ?? 0;
  const bullish = (data?.strongBuy ?? 0) + (data?.buy ?? 0);
  const hold = data?.hold ?? 0;
  const bearish = (data?.sell ?? 0) + (data?.strongSell ?? 0);

  const bullPct = total > 0 ? (bullish / total) * 100 : 0;
  const holdPct = total > 0 ? (hold / total) * 100 : 0;
  const bearPct = total > 0 ? (bearish / total) * 100 : 0;

  const upside =
    data?.priceTarget != null && currentPrice
      ? ((data.priceTarget - currentPrice) / currentPrice) * 100
      : null;

  const staleDays = data?.asOf ? daysAgo(data.asOf) : null;

  return (
    <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
        Analyst Ratings
      </h3>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-2 bg-gray-200 rounded-full w-full" />
          <div className="h-3 bg-gray-100 rounded w-2/3" />
        </div>
      ) : total > 0 ? (
        <div className="space-y-3">
          {/* Proportional consensus bar */}
          <div className="flex h-2 rounded-full overflow-hidden gap-px">
            {bullPct > 0 && (
              <div style={{ width: `${bullPct}%` }} className="bg-green-500 rounded-l-full" />
            )}
            {holdPct > 0 && <div style={{ width: `${holdPct}%` }} className="bg-gray-300" />}
            {bearPct > 0 && (
              <div style={{ width: `${bearPct}%` }} className="bg-red-500 rounded-r-full" />
            )}
          </div>

          {/* Count labels */}
          <div className="flex justify-between text-xs">
            <span className="text-green-600 font-medium">{bullish} Buy</span>
            <span className="text-gray-500">{hold} Hold</span>
            <span className="text-red-600 font-medium">{bearish} Sell</span>
          </div>

          {/* Individual breakdown */}
          <div className="grid grid-cols-5 gap-1 text-center">
            {[
              { label: 'Str Buy', value: data?.strongBuy ?? 0, color: 'text-green-700' },
              { label: 'Buy', value: data?.buy ?? 0, color: 'text-green-500' },
              { label: 'Hold', value: data?.hold ?? 0, color: 'text-gray-500' },
              { label: 'Sell', value: data?.sell ?? 0, color: 'text-red-500' },
              { label: 'Str Sell', value: data?.strongSell ?? 0, color: 'text-red-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-100 rounded p-1.5">
                <div className={clsx('text-sm font-semibold', color)}>{value}</div>
                <div className="text-xs text-gray-400 leading-tight">{label}</div>
              </div>
            ))}
          </div>

          {/* Price target */}
          {data?.priceTarget != null && (
            <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-2 mt-1">
              <span className="text-gray-500">Price target</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">${data.priceTarget.toFixed(2)}</span>
                {upside != null && (
                  <span
                    className={clsx(
                      'text-xs font-medium',
                      upside >= 0 ? 'text-green-600' : 'text-red-600',
                    )}
                  >
                    {upside >= 0 ? '+' : ''}
                    {upside.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {staleDays != null && (
            <p className="text-xs text-gray-400">
              as of{' '}
              {staleDays === 0 ? 'today' : `${staleDays} day${staleDays === 1 ? '' : 's'} ago`}
            </p>
          )}
        </div>
      ) : (
        <p className="text-gray-600 text-sm">No analyst coverage</p>
      )}
    </div>
  );
}

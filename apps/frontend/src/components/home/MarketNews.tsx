'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MarketOverview } from '@/types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function MarketNews(): React.JSX.Element {
  const { data, isLoading } = useQuery<MarketOverview>({
    queryKey: ['market-overview'],
    queryFn: () => api.get<MarketOverview>('/market/overview').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Market News</h2>
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-3/4" />
              <div className="h-2 bg-gray-100 rounded w-16 mt-1" />
            </div>
          ))}
        </div>
      ) : !data?.news.length ? (
        <p className="text-sm text-gray-400 py-4 text-center">No news available</p>
      ) : (
        <ul className="space-y-3 flex-1 overflow-hidden">
          {data.news.map((item, i) => (
            <li key={i} className="border-b border-gray-50 last:border-0 pb-2.5 last:pb-0">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="group">
                <p className="text-sm text-gray-900 font-medium leading-snug group-hover:text-blue-600 transition-colors line-clamp-2">
                  {item.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {item.source} · {timeAgo(item.publishedAt)}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

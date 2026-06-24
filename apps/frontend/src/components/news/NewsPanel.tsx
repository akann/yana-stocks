'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';

interface NewsArticle {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentimentLabel: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
}

export function NewsPanel({ symbol }: { symbol: string }): React.JSX.Element {
  const { data: articles = [], isLoading } = useQuery<NewsArticle[]>({
    queryKey: ['news', symbol],
    queryFn: () => api.get<NewsArticle[]>(`/news/${symbol}`).then((r) => r.data),
    staleTime: 300_000,
  });

  return (
    <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
        Recent News
      </h3>
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-4 bg-gray-100 rounded w-full" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : articles.length > 0 ? (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.url} className="border-b border-gray-200 pb-3 last:border-0 last:pb-0">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-700 hover:text-gray-900 leading-snug block mb-1"
              >
                {a.headline}
              </a>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">{a.source}</span>
                <span
                  className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', {
                    'bg-green-50 text-green-600': a.sentimentLabel === 'positive',
                    'bg-red-50 text-red-600': a.sentimentLabel === 'negative',
                    'bg-gray-200 text-gray-600': a.sentimentLabel === 'neutral',
                  })}
                >
                  {a.sentimentLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-600 text-sm">No news available</p>
      )}
    </div>
  );
}

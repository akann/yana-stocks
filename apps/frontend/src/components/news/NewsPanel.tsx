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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Recent News
      </h3>
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-4 bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-800 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : articles.length > 0 ? (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.url} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-200 hover:text-white leading-snug block mb-1"
              >
                {a.headline}
              </a>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{a.source}</span>
                <span
                  className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', {
                    'bg-green-900 text-green-400': a.sentimentLabel === 'positive',
                    'bg-red-900 text-red-400': a.sentimentLabel === 'negative',
                    'bg-gray-700 text-gray-400': a.sentimentLabel === 'neutral',
                  })}
                >
                  {a.sentimentLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 text-sm">No news available</p>
      )}
    </div>
  );
}

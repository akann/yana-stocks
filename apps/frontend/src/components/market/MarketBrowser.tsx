'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AddToWatchlistButton } from '@/components/watchlist/AddToWatchlistButton';
import type { AssetMarket, AssetsPage } from '@/types';

const PAGE_SIZE = 20;

const TABS: { id: AssetMarket; label: string }[] = [
  { id: 'us', label: '🇺🇸 US Equities' },
  { id: 'etf', label: '📊 ETFs' },
  { id: 'uk', label: '🇬🇧 UK Equities' },
  { id: 'global', label: '🌍 Global' },
];

export function MarketBrowser({
  defaultTab = 'us',
}: { defaultTab?: AssetMarket } = {}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AssetMarket>(defaultTab);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const userSelectedRef = useRef(false);

  useEffect(() => {
    if (!userSelectedRef.current) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const { data, isLoading, isError } = useQuery<AssetsPage>({
    queryKey: ['market-assets', activeTab, search, page],
    queryFn: () =>
      api
        .get<AssetsPage>('/market/assets', {
          params: { market: activeTab, search, page, limit: PAGE_SIZE },
        })
        .then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  function handleTabChange(tab: AssetMarket) {
    userSelectedRef.current = true;
    setActiveTab(tab);
    setSearch('');
    setPage(1);
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-4 pb-0 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={handleSearch}
            placeholder="Search symbol or name…"
            className="flex-1 min-w-40 max-w-64 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 uppercase"
          />
        </div>
      </div>

      <div className="mt-3">
        {isLoading && <div className="py-12 text-center text-sm text-gray-500">Loading…</div>}

        {isError && (
          <div className="py-12 text-center text-sm text-red-500">Failed to load assets</div>
        )}

        {!isLoading && !isError && data && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 w-24">Symbol</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Name</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 hidden sm:table-cell">
                    Exchange
                  </th>
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-sm text-gray-400">
                      No results for &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                ) : (
                  data.data.map((asset) => (
                    <tr
                      key={asset.symbol}
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/stocks/${asset.symbol}`}
                          className="font-mono font-semibold text-blue-600 hover:underline"
                        >
                          {asset.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 truncate max-w-xs">{asset.name}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs hidden sm:table-cell">
                        {asset.exchange}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <AddToWatchlistButton symbol={asset.symbol} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {data.total}{' '}
                  {activeTab === 'etf' ? 'ETFs' : activeTab === 'uk' ? 'UK equities' : 'equities'}
                  {search ? ` matching "${search.toUpperCase()}"` : ''}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                  >
                    ← Prev
                  </button>
                  <span className="px-3 py-1 text-xs text-gray-500">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

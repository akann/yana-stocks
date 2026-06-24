'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';

interface AssetEntry {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
}

interface AssetsPage {
  data: AssetEntry[];
  total: number;
  page: number;
  limit: number;
}

const LIMIT = 20;

export function StockBrowser(): React.JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError } = useQuery<AssetsPage>({
    queryKey: ['assets', debouncedSearch, page],
    queryFn: () =>
      api
        .get<AssetsPage>('/market/assets', {
          params: { search: debouncedSearch, page, limit: LIMIT },
        })
        .then((r) => r.data),
    staleTime: 300_000,
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="text-lg font-semibold text-gray-900 shrink-0">All Stocks</h2>
        <input
          type="text"
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by symbol or name…"
          className="w-full max-w-xs bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
              <th className="text-left pb-2 pr-4 font-medium">Symbol</th>
              <th className="text-left pb-2 pr-4 font-medium">Name</th>
              <th className="text-left pb-2 font-medium">Exchange</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: LIMIT }).map((_, i) => (
                <tr key={i} className="border-b border-gray-200/50">
                  <td className="py-2 pr-4">
                    <div className="h-4 bg-gray-100 rounded w-16 animate-pulse" />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
                  </td>
                  <td className="py-2">
                    <div className="h-4 bg-gray-100 rounded w-12 animate-pulse" />
                  </td>
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-red-600 text-sm">
                  Could not load stocks — make sure portfolio-api is running on port 3006
                </td>
              </tr>
            ) : data?.data.length ? (
              data.data.map((asset) => (
                <tr
                  key={asset.symbol}
                  onClick={() => router.push(`/stocks/${asset.symbol}`)}
                  className="border-b border-gray-200/50 hover:bg-gray-100/50 cursor-pointer transition-colors"
                >
                  <td className="py-2 pr-4 font-mono font-semibold text-blue-600">
                    {asset.symbol}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 truncate max-w-xs">{asset.name}</td>
                  <td className="py-2 text-gray-500 text-xs">{asset.exchange}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="py-8 text-center text-gray-500">
                  No stocks found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">
            {data ? `${data.total.toLocaleString()} results` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <span className="text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

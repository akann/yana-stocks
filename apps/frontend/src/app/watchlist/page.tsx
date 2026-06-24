'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { WatchlistCard } from '@/components/watchlist/WatchlistCard';
import type { StockAggregate, Watchlist } from '@/types';

export default function WatchlistPage(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [newListName, setNewListName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  // ── Watchlists ───────────────────────────────────────────────
  const {
    data: watchlists,
    isLoading: listsLoading,
    isError,
  } = useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: () => api.get<Watchlist[]>('/portfolio/watchlists').then((r) => r.data),
    enabled: isAuthenticated,
  });

  // ── Live prices for every watched symbol ─────────────────────
  const symbols = useMemo(() => {
    const s = new Set<string>();
    (watchlists ?? []).forEach((wl) => wl.symbols.forEach((sym) => s.add(sym)));
    return [...s];
  }, [watchlists]);

  const priceResults = useQueries({
    queries: symbols.map((sym) => ({
      queryKey: ['stock', sym],
      queryFn: () => api.get<StockAggregate>(`/stocks/${sym}`).then((r) => r.data),
      refetchInterval: 10_000,
      staleTime: 5_000,
    })),
  });

  const livePrices = useMemo(() => {
    const map: Record<string, StockAggregate> = {};
    symbols.forEach((sym, i) => {
      const d = priceResults[i]?.data;
      if (d) map[sym] = d;
    });
    return map;
  }, [symbols, priceResults]);

  // ── Mutations ────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/portfolio/watchlists', { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlists'] });
      setNewListName('');
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/portfolio/watchlists/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlists'] }),
  });

  const addSymbolMutation = useMutation({
    mutationFn: ({ id, symbol }: { id: string; symbol: string }) =>
      api.post(`/portfolio/watchlists/${id}/symbols`, { symbol }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlists'] }),
  });

  const removeSymbolMutation = useMutation({
    mutationFn: ({ id, symbol }: { id: string; symbol: string }) =>
      api.delete(`/portfolio/watchlists/${id}/symbols/${symbol}`),
    onMutate: ({ symbol }) => setRemovingSymbol(symbol),
    onSettled: () => setRemovingSymbol(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlists'] }),
  });

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-100 rounded-xl h-32" />;
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Watchlists</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Watchlist
        </button>
      </div>

      {/* ── Create form ── */}
      {showCreate && (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Create Watchlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newListName.trim()) createMutation.mutate(newListName.trim());
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="e.g. AI Stocks"
              className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-500 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </form>
          {createMutation.isError && (
            <p className="text-red-600 text-xs mt-2">Failed to create watchlist.</p>
          )}
        </div>
      )}

      {/* ── List ── */}
      {listsLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-40" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          Could not load watchlists — make sure portfolio-service is running on port 3005.
        </div>
      ) : watchlists && watchlists.length > 0 ? (
        <div className="space-y-5">
          {watchlists.map((wl) => (
            <WatchlistCard
              key={wl.id}
              watchlist={wl}
              livePrices={livePrices}
              onDelete={() => deleteMutation.mutate(wl.id)}
              onAddSymbol={(symbol) => addSymbolMutation.mutate({ id: wl.id, symbol })}
              onRemoveSymbol={(symbol) => removeSymbolMutation.mutate({ id: wl.id, symbol })}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === wl.id}
              removingSymbol={removingSymbol}
            />
          ))}
        </div>
      ) : (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-gray-500 text-base font-medium">No watchlists yet</p>
          <p className="text-gray-500 text-sm">
            Create a watchlist to track symbols with live prices and sentiment.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-2 inline-block bg-blue-600 hover:bg-blue-700 text-gray-900 px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + New Watchlist
          </button>
        </div>
      )}
    </div>
  );
}

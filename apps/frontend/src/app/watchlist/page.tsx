'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { Watchlist } from '@/types';

export default function WatchlistPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [newSymbol, setNewSymbol] = useState('');
  const [targetWatchlistId, setTargetWatchlistId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const { data: watchlists, isLoading: listsLoading } = useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: () => api.get<Watchlist[]>('/portfolio/watchlists').then((r) => r.data),
    enabled: isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/portfolio/watchlists', { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlists'] });
      setNewListName('');
      setShowCreate(false);
    },
  });

  const addSymbolMutation = useMutation({
    mutationFn: ({ id, symbol }: { id: string; symbol: string }) =>
      api.post(`/portfolio/watchlists/${id}/symbols`, { symbol }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlists'] });
      setNewSymbol('');
      setTargetWatchlistId(null);
    },
  });

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-32" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Watchlists</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          New Watchlist
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Create Watchlist</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newListName.trim()) createMutation.mutate(newListName.trim());
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Watchlist name"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>
      )}

      {listsLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-800 rounded-xl h-24" />
          ))}
        </div>
      ) : watchlists && watchlists.length > 0 ? (
        <div className="space-y-4">
          {watchlists.map((wl) => (
            <div
              key={wl.id}
              className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-medium text-white">{wl.name}</h3>
                <button
                  onClick={() => setTargetWatchlistId(wl.id)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add
                </button>
              </div>
              {targetWatchlistId === wl.id && (
                <div className="px-4 py-3 border-b border-gray-800 bg-gray-800/50">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const sym = newSymbol.trim().toUpperCase();
                      if (sym) addSymbolMutation.mutate({ id: wl.id, symbol: sym });
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      placeholder="Symbol (e.g. AAPL)"
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 uppercase"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setTargetWatchlistId(null)}
                      className="text-gray-400 hover:text-gray-300 text-sm px-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={addSymbolMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
                    >
                      Add
                    </button>
                  </form>
                </div>
              )}
              {wl.symbols.length > 0 ? (
                <div className="divide-y divide-gray-800">
                  {wl.symbols.map((sym) => (
                    <div
                      key={sym}
                      className="px-4 py-3 flex items-center justify-between hover:bg-gray-800/40"
                    >
                      <Link
                        href={`/stocks/${sym}`}
                        className="font-medium text-white hover:text-blue-400 transition-colors"
                      >
                        {sym}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm px-4 py-4 text-center">No symbols yet</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">No watchlists yet. Create one above.</p>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { Watchlist } from '@/types';

interface Props {
  symbol: string;
  excludeWatchlistId?: string;
}

export function AddToWatchlistButton({ symbol, excludeWatchlistId }: Props): React.JSX.Element {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: watchlists, isLoading: watchlistsLoading } = useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: () => api.get<Watchlist[]>('/portfolio/watchlists').then((r) => r.data),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (watchlistId: string) =>
      api.post(`/portfolio/watchlists/${watchlistId}/symbols`, { symbol }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlists'] });
      setOpen(false);
      setDone(true);
      setTimeout(() => setDone(false), 2_000);
    },
  });

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const eligible = (watchlists ?? []).filter((wl) => wl.id !== excludeWatchlistId);

  function handleClick() {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    if (eligible.length === 0) {
      router.push('/watchlist');
      return;
    }
    if (eligible.length === 1) {
      mutate(eligible[0]!.id);
      return;
    }
    setOpen((prev) => !prev);
  }

  const btnLabel = done ? '✓' : isPending ? '…' : '+';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={handleClick}
        disabled={authLoading || watchlistsLoading}
        title={`Add ${symbol} to watchlist`}
        aria-label={`Add ${symbol} to watchlist`}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
      >
        {btnLabel}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-max">
          {eligible.map((wl) => (
            <button
              key={wl.id}
              onClick={() => mutate(wl.id)}
              className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {wl.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

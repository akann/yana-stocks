'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';
import { AddStockModal } from '@/components/portfolio/AddStockModal';
import type { Portfolio, StockAggregate } from '@/types';

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function PortfolioPage(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [addingToPortfolio, setAddingToPortfolio] = useState<string | null>(null);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  // ── Portfolios ──────────────────────────────────────────────
  const {
    data: portfolios,
    isLoading: portfoliosLoading,
    isError,
  } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: () => api.get<Portfolio[]>('/portfolio/portfolios').then((r) => r.data),
    enabled: isAuthenticated,
  });

  // ── Live prices for every holding symbol ─────────────────────
  const symbols = useMemo(() => {
    const s = new Set<string>();
    (portfolios ?? []).forEach((p) => p.stocks.forEach((h) => s.add(h.symbol)));
    return [...s];
  }, [portfolios]);

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

  // ── Summary across all portfolios ────────────────────────────
  const summary = useMemo(() => {
    if (!portfolios?.length) return null;
    let totalValue = 0;
    let totalCost = 0;
    for (const p of portfolios) {
      for (const h of p.stocks) {
        const lp = livePrices[h.symbol]?.price;
        totalValue += (lp ?? h.avgCostBasis) * h.shares;
        totalCost += h.avgCostBasis * h.shares;
      }
    }
    return { totalValue, totalCost, pnl: totalValue - totalCost };
  }, [portfolios, livePrices]);

  // ── Mutations ────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/portfolio/portfolios', { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolios'] });
      setNewPortfolioName('');
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/portfolio/portfolios/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portfolios'] }),
  });

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-100 rounded-xl h-32" />;
  }

  const pnlColor = (summary?.pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Portfolios</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Portfolio
        </button>
      </div>

      {/* ── Create form ── */}
      {showCreate && (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Create Portfolio</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newPortfolioName.trim()) createMutation.mutate(newPortfolioName.trim());
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              type="text"
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              placeholder="e.g. Tech Growth"
              className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm transition-colors"
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
          {createMutation.isError && (
            <p className="text-red-600 text-xs mt-2">Failed to create portfolio.</p>
          )}
        </div>
      )}

      {/* ── Summary card ── */}
      {summary && (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-4">
            Overall Summary
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">
                Market Value
              </div>
              <div className="text-xl font-bold text-gray-900">${fmt(summary.totalValue)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Invested</div>
              <div className="text-xl font-bold text-gray-900">${fmt(summary.totalCost)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">
                Unrealized P&amp;L
              </div>
              <div className={`text-xl font-bold ${pnlColor}`}>
                {summary.pnl >= 0 ? '+' : ''}${fmt(Math.abs(summary.pnl))}
                <span className="text-sm font-medium ml-2">
                  ({summary.pnl >= 0 ? '+' : ''}
                  {summary.totalCost > 0 ? fmt((summary.pnl / summary.totalCost) * 100) : '0.00'}
                  %)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Portfolio list ── */}
      {portfoliosLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-40" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-600">
          Could not load portfolios — make sure portfolio-service is running on port 3005.
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="space-y-5">
          {portfolios.map((p) => (
            <PortfolioTable
              key={p.id}
              portfolio={p}
              livePrices={livePrices}
              onAddStock={() => setAddingToPortfolio(p.id)}
              onDelete={() => deleteMutation.mutate(p.id)}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === p.id}
            />
          ))}
        </div>
      ) : (
        <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-gray-600 text-base font-medium">No portfolios yet</p>
          <p className="text-gray-600 text-sm">
            Create your first portfolio to track your holdings.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-2 inline-block bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + New Portfolio
          </button>
        </div>
      )}

      {addingToPortfolio && (
        <AddStockModal portfolioId={addingToPortfolio} onClose={() => setAddingToPortfolio(null)} />
      )}
    </div>
  );
}

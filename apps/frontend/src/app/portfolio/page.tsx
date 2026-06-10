'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';
import { AddStockModal } from '@/components/portfolio/AddStockModal';
import type { Portfolio } from '@/types';

export default function PortfolioPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [addingToPortfolio, setAddingToPortfolio] = useState<string | null>(null);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const { data: portfolios, isLoading: portfoliosLoading } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: () => api.get<Portfolio[]>('/portfolio/portfolios').then((r) => r.data),
    enabled: isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/portfolio/portfolios', { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolios'] });
      setNewPortfolioName('');
      setShowCreate(false);
    },
  });

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-32" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Portfolios</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          New Portfolio
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Create Portfolio</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newPortfolioName.trim()) createMutation.mutate(newPortfolioName.trim());
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              placeholder="Portfolio name"
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

      {portfoliosLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-800 rounded-xl h-32" />
          ))}
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="space-y-4">
          {portfolios.map((p) => (
            <div key={p.id}>
              <PortfolioTable portfolio={p} />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => setAddingToPortfolio(p.id)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add Stock
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">No portfolios yet. Create one above.</p>
      )}

      {addingToPortfolio && (
        <AddStockModal
          portfolioId={addingToPortfolio}
          onClose={() => setAddingToPortfolio(null)}
        />
      )}
    </div>
  );
}

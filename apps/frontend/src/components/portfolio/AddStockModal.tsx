'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Props {
  portfolioId: string;
  onClose: () => void;
}

export function AddStockModal({ portfolioId, onClose }: Props): React.JSX.Element {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/portfolio/portfolios/${portfolioId}/stocks`, {
        symbol: symbol.toUpperCase(),
        shares: Number(shares),
        price: Number(price),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolios'] });
      onClose();
    },
    onError: () => setError('Failed to add stock. Please try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!symbol || !shares || !price) {
      setError('All fields are required.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Stock</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 uppercase"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Shares</label>
            <input
              type="number"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="10"
              min="0.001"
              step="any"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Purchase Price</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="150.00"
              min="0.01"
              step="any"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg transition-colors"
            >
              {mutation.isPending ? 'Adding…' : 'Add Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

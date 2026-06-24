'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoversCard } from '@/components/market/MoversCard';
import { StockBrowser } from '@/components/market/StockBrowser';

export function HomePageView(): React.JSX.Element {
  const [symbol, setSymbol] = useState('');
  const router = useRouter();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = symbol.trim().toUpperCase();
    if (trimmed) {
      router.push(`/stocks/${trimmed}`);
    }
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900">Stock Market Dashboard</h1>
        <p className="text-gray-600">Real-time prices, sentiment analysis, and ML predictions</p>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm mx-auto">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Search symbol (e.g. AAPL)"
            className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 uppercase"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Go
          </button>
        </form>
      </div>
      <MoversCard />
      <StockBrowser />
    </div>
  );
}

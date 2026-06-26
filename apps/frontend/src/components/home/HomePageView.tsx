'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndicesBar } from '@/components/home/IndicesBar';
import { SectorHeatmap } from '@/components/home/SectorHeatmap';
import { MarketNews } from '@/components/home/MarketNews';
import { StockScreener } from '@/components/home/StockScreener';
import { MoversCard } from '@/components/market/MoversCard';
import { MarketBrowser } from '@/components/market/MarketBrowser';

const BOTTOM_TABS = [
  { id: 'browser', label: 'Market Browser' },
  { id: 'screener', label: 'Stock Screener' },
] as const;

type BottomTab = (typeof BOTTOM_TABS)[number]['id'];

export function HomePageView(): React.JSX.Element {
  const symbolRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<BottomTab>('browser');

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = (symbolRef.current?.value ?? '').trim().toUpperCase();
    if (trimmed) {
      router.push(`/stocks/${trimmed}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4 py-6">
        <h1 className="text-3xl font-bold text-gray-900">Stock Market Dashboard</h1>
        <p className="text-gray-600">Real-time prices, sentiment analysis, and ML predictions</p>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm mx-auto">
          <input
            ref={symbolRef}
            type="text"
            defaultValue=""
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

      <IndicesBar />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectorHeatmap />
        <MarketNews />
      </div>

      <MoversCard />

      <div>
        <div className="flex border-b border-gray-200 mb-0">
          {BOTTOM_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'browser' ? <MarketBrowser /> : <StockScreener />}
      </div>
    </div>
  );
}

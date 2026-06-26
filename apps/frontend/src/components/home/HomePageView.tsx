'use client';

import React, { useState } from 'react';
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
  const [activeTab, setActiveTab] = useState<BottomTab>('browser');

  return (
    <div className="space-y-6">
      <div className="text-center py-6">
        <h1 className="text-3xl font-bold text-gray-900">Stock Market Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Real-time prices, sentiment analysis, and ML predictions
        </p>
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

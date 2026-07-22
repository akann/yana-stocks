'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { IndicesBar } from '@/components/home/IndicesBar';
import { SectorRotationHeatmap } from '@/components/home/SectorRotationHeatmap';
import { MarketNews } from '@/components/home/MarketNews';
import { MoversCard } from '@/components/market/MoversCard';
import { FactorTiles } from '@/components/home/FactorTiles';
import { useAuth } from '@/context/AuthContext';
import type { AssetMarket } from '@/types';

// Below-the-fold, single-tab-visible-at-a-time: code-split out of the main
// homepage bundle so their JS (search/pagination logic, screener filters)
// isn't parsed/executed until the user actually reaches this section.
// (Confirmed via live testing this is NOT the source of an intermittent
// hydration mismatch seen elsewhere on this page — reverting to static
// imports made no difference, so this stays.)
const MarketBrowser = dynamic(
  () => import('@/components/market/MarketBrowser').then((m) => m.MarketBrowser),
  { loading: () => <div className="animate-pulse bg-gray-100 rounded-xl h-96 mt-4" /> },
);
const StockScreener = dynamic(
  () => import('@/components/home/StockScreener').then((m) => m.StockScreener),
  { loading: () => <div className="animate-pulse bg-gray-100 rounded-xl h-96 mt-4" /> },
);

const BOTTOM_TABS = [
  { id: 'browser', label: 'Market Browser' },
  { id: 'screener', label: 'Stock Screener' },
] as const;

type BottomTab = (typeof BOTTOM_TABS)[number]['id'];

function defaultMarketTab(pref: 'US' | 'UK' | 'global' | undefined): AssetMarket {
  if (pref === 'UK') return 'uk';
  if (pref === 'global') return 'global';
  return 'us';
}

export function HomePageView(): React.JSX.Element {
  const { profile } = useAuth();
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

      <FactorTiles />

      <MoversCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectorRotationHeatmap />
        <MarketNews />
      </div>

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
        {activeTab === 'browser' ? (
          <MarketBrowser defaultTab={defaultMarketTab(profile?.preferences?.defaultMarket)} />
        ) : (
          <StockScreener />
        )}
      </div>
    </div>
  );
}

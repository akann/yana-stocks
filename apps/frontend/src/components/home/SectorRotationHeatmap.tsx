'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cellColor, textColor } from '@/lib/sectorColors';
import type { MarketOverview, SectorRotationData } from '@/types';

// recharts + its transitive deps (d3-scale/d3-shape/d3-color, redux-toolkit,
// immer, es-toolkit) are ~176 KiB the homepage doesn't need until this view
// actually renders — code-split out of the main bundle, same pattern as
// MarketBrowser/StockScreener in HomePageView.tsx. Loading fallback matches
// this component's own isLoading skeleton height so switching between them
// (skeleton -> chunk loading -> content) never shifts layout.
const TreemapView = dynamic(
  () => import('@/components/home/SectorTreemapView').then((m) => m.TreemapView),
  { loading: () => <div className="h-64 bg-gray-50 animate-pulse rounded-lg" /> },
);

type Index = 'sp500' | 'ftse100';
type View = 'today' | 'history';

const INDICES: { id: Index; label: string }[] = [
  { id: 'sp500', label: 'S&P 500' },
  { id: 'ftse100', label: 'FTSE 100' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function HistoryView({
  data,
  activeIndex,
}: {
  data: SectorRotationData | undefined;
  activeIndex: Index;
}): React.JSX.Element {
  const isEmpty = !data?.rows.length || !data.dates.length;
  if (isEmpty) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500">
        {activeIndex === 'ftse100' ? 'No FTSE 100 sector history' : 'No sector data available'}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 480 }}>
        <thead>
          <tr>
            <th className="text-left pr-2 pb-1.5 font-medium text-gray-500 w-32 whitespace-nowrap">
              Sector
            </th>
            {data.dates.map((d) => (
              <th
                key={d}
                className="pb-1.5 font-medium text-gray-500 text-center whitespace-nowrap px-0.5"
                style={{ minWidth: 44 }}
              >
                {fmtDate(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.sector}>
              <td className="pr-2 py-0.5 text-gray-700 font-medium whitespace-nowrap">
                {row.sector}
              </td>
              {row.changes.map((pct, i) => (
                <td key={i} className="py-0.5 px-0.5 text-center">
                  <div
                    className="rounded text-center leading-none py-1"
                    style={{
                      backgroundColor: cellColor(pct),
                      color: textColor(pct),
                      minWidth: 40,
                    }}
                    title={`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                  >
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(1)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SectorRotationHeatmap(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState<Index>('sp500');
  const [view, setView] = useState<View>('today');

  const { data: rotationData, isLoading: rotLoading } = useQuery<SectorRotationData>({
    queryKey: ['sector-rotation', activeIndex],
    queryFn: () =>
      api
        .get<SectorRotationData>('/market/sectors/rotation', { params: { index: activeIndex } })
        .then((r) => r.data),
    staleTime: 3_600_000,
  });

  // Overview is only needed as a fallback for the S&P 500 treemap when rotation has no data
  const needsOverview = activeIndex === 'sp500' && view === 'today';
  const { data: overviewData, isLoading: overviewLoading } = useQuery<MarketOverview>({
    queryKey: ['market-overview'],
    queryFn: () => api.get<MarketOverview>('/market/overview').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: needsOverview,
  });

  // Hold the skeleton until we have a settled data source: if rotation came back empty
  // and we might fall back to overview, wait for overview too before revealing the treemap.
  const rotationHasData = !!rotationData?.rows.length;
  const isLoading = rotLoading || (needsOverview && !rotationHasData && overviewLoading);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-700">Sector Rotation</h2>
        <div className="flex items-center gap-2">
          {/* Today / History toggle */}
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {(['today', 'history'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
                  view === v
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-700'
                }`}
              >
                {v === 'today' ? 'Today' : 'History'}
              </button>
            ))}
          </div>
          {/* Index switcher */}
          <div className="flex gap-1">
            {INDICES.map((idx) => (
              <button
                key={idx.id}
                onClick={() => setActiveIndex(idx.id)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  activeIndex === idx.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {idx.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="h-64 bg-gray-50 animate-pulse rounded-lg" />}

      {!isLoading && view === 'today' && (
        <TreemapView
          activeIndex={activeIndex}
          rotationData={rotationData}
          overviewData={overviewData}
        />
      )}

      {!isLoading && view === 'history' && (
        <HistoryView data={rotationData} activeIndex={activeIndex} />
      )}
    </div>
  );
}

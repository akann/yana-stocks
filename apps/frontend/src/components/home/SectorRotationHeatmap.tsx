'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '@/lib/api';
import type { MarketOverview, SectorRotationData } from '@/types';

type Index = 'sp500' | 'ftse100';
type View = 'today' | 'history';

const INDICES: { id: Index; label: string }[] = [
  { id: 'sp500', label: 'S&P 500' },
  { id: 'ftse100', label: 'FTSE 100' },
];

// Approximate market-cap weights by index (source: SPDR / iShares, rounded)
const SP500_WEIGHTS: Record<string, number> = {
  Technology: 29,
  Financials: 13,
  'Health Care': 12,
  'Consumer Discretionary': 10,
  Industrials: 9,
  'Communication Services': 8,
  'Consumer Staples': 6,
  Energy: 4,
  'Real Estate': 2.5,
  Materials: 2.5,
  Utilities: 2.5,
};

const FTSE_WEIGHTS: Record<string, number> = {
  Financials: 18,
  'Consumer Staples': 14,
  'Health Care': 12,
  Industrials: 11,
  'Consumer Discretionary': 10,
  Energy: 10,
  Materials: 9,
  'Communication Services': 5,
  Technology: 4,
  Utilities: 4,
  'Real Estate': 3,
};

// Normalise rotation sector names to the weight-map names
const ROTATION_TO_WEIGHT: Record<string, string> = {
  'Consumer Disc.': 'Consumer Discretionary',
  'Comm. Services': 'Communication Services',
};

function normSector(s: string): string {
  return ROTATION_TO_WEIGHT[s] ?? s;
}

function cellColor(pct: number): string {
  if (pct >= 2) return '#15803d';
  if (pct >= 1) return '#16a34a';
  if (pct >= 0.25) return '#4ade80';
  if (pct >= 0) return '#bbf7d0';
  if (pct >= -0.25) return '#fecaca';
  if (pct >= -1) return '#f87171';
  if (pct >= -2) return '#dc2626';
  return '#991b1b';
}

function textColor(pct: number): string {
  return Math.abs(pct) >= 0.25 ? '#ffffff' : '#374151';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Treemap pieces ───────────────────────────────────────────────────────────

interface TreemapItem {
  name: string;
  value: number;
  pct: number;
  [key: string]: unknown;
}

interface ContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  pct?: number;
}

function CustomContent(props: ContentProps): React.JSX.Element | null {
  const { x = 0, y = 0, width = 0, height = 0, name = '', pct = 0 } = props;
  if (width < 30 || height < 24) return null;
  const label = name
    .replace('Consumer Discretionary', 'Cons. Disc.')
    .replace('Consumer Staples', 'Cons. Staples')
    .replace('Communication Services', 'Comm. Svcs')
    .replace('Health Care', 'Health Care');
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={cellColor(pct)}
        rx={4}
        stroke="#fff"
        strokeWidth={2}
      />
      {width > 55 && height > 36 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 7}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(12, width / 8)}
            fontWeight={600}
          >
            {label}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 9}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(11, width / 9)}
          >
            {pct >= 0 ? '+' : ''}
            {pct.toFixed(2)}%
          </text>
        </>
      )}
    </g>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload?: TreemapItem }[];
}

function SectorTooltip({ active, payload }: TooltipProps): React.JSX.Element | null {
  if (!active || !payload?.[0]?.payload) return null;
  const { name, pct } = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-sm">
      <p className="font-semibold text-gray-900">{name}</p>
      <p className={`font-medium ${pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
        {pct >= 0 ? '+' : ''}
        {pct.toFixed(2)}%
      </p>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TreemapView({
  activeIndex,
  rotationData,
  overviewData,
}: {
  activeIndex: Index;
  rotationData: SectorRotationData | undefined;
  overviewData: MarketOverview | undefined;
}): React.JSX.Element {
  const weights = activeIndex === 'ftse100' ? FTSE_WEIGHTS : SP500_WEIGHTS;

  // Prefer the last column of rotation data (today); fall back to overview sectors
  const pctMap = new Map<string, number>();
  if (rotationData?.rows.length && rotationData.dates.length) {
    const lastIdx = rotationData.dates.length - 1;
    for (const row of rotationData.rows) {
      pctMap.set(normSector(row.sector), row.changes[lastIdx] ?? 0);
    }
  } else if (activeIndex === 'sp500' && overviewData?.sectors.length) {
    for (const s of overviewData.sectors) {
      pctMap.set(s.sector, s.changesPercentage);
    }
  }

  const treeData: TreemapItem[] = Object.entries(weights)
    .map(([name, value]) => ({ name, value, pct: pctMap.get(name) ?? 0 }))
    .sort((a, b) => b.value - a.value);

  if (!pctMap.size) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-400">No data</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <Treemap data={treeData} dataKey="value" content={<CustomContent />}>
        <Tooltip content={<SectorTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
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
      <div className="h-64 flex items-center justify-center text-sm text-gray-400">
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
                className="pb-1.5 font-medium text-gray-400 text-center whitespace-nowrap px-0.5"
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
  const { data: overviewData } = useQuery<MarketOverview>({
    queryKey: ['market-overview'],
    queryFn: () => api.get<MarketOverview>('/market/overview').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: activeIndex === 'sp500' && view === 'today',
  });

  const isLoading = rotLoading;

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
                    : 'text-gray-500 hover:text-gray-700'
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

'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '@/lib/api';
import type { MarketOverview, SectorPerformance } from '@/types';

// Approximate S&P 500 sector market-cap weights (source: SPDR ETF weights, rounded)
const SECTOR_WEIGHTS: Record<string, number> = {
  Technology: 29,
  'Health Care': 12,
  Financials: 13,
  'Consumer Discretionary': 10,
  Industrials: 9,
  'Communication Services': 8,
  'Consumer Staples': 6,
  Energy: 4,
  'Real Estate': 2.5,
  Materials: 2.5,
  Utilities: 2.5,
};

function perfColor(pct: number): string {
  if (pct >= 1.5) return '#16a34a'; // strong green
  if (pct >= 0.5) return '#4ade80'; // light green
  if (pct >= 0) return '#86efac'; // pale green
  if (pct >= -0.5) return '#fca5a5'; // pale red
  if (pct >= -1.5) return '#f87171'; // light red
  return '#dc2626'; // strong red
}

interface TreemapItem {
  name: string;
  value: number;
  pct: number;
  fill: string;
  [key: string]: unknown;
}

interface CustomContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  pct?: number;
}

function CustomContent(props: CustomContentProps): React.JSX.Element | null {
  const { x = 0, y = 0, width = 0, height = 0, name = '', pct = 0 } = props;
  if (width < 40 || height < 30) return null;
  const positive = pct >= 0;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={perfColor(pct)}
        rx={4}
        stroke="#fff"
        strokeWidth={2}
      />
      {width > 60 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            fill="#fff"
            fontSize={11}
            fontWeight={600}
          >
            {name.replace('Consumer ', 'Cons. ')}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#fff"
            fontSize={11}
          >
            {positive ? '+' : ''}
            {pct.toFixed(2)}%
          </text>
        </>
      )}
    </g>
  );
}

interface TooltipPayloadItem {
  payload?: TreemapItem;
}

function SectorTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}): React.JSX.Element | null {
  if (!active || !payload?.[0]?.payload) return null;
  const { name, pct } = payload[0].payload;
  const positive = pct >= 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-sm">
      <p className="font-semibold text-gray-900">{name}</p>
      <p className={`font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
        {positive ? '+' : ''}
        {pct.toFixed(2)}%
      </p>
    </div>
  );
}

export function SectorHeatmap(): React.JSX.Element {
  const { data, isLoading } = useQuery<MarketOverview>({
    queryKey: ['market-overview'],
    queryFn: () => api.get<MarketOverview>('/market/overview').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data?.sectors.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">S&P 500 Sectors</h2>
        <div className="h-64 bg-gray-50 animate-pulse rounded-lg" />
      </div>
    );
  }

  const sectorMap = new Map<string, number>(
    data.sectors.map((s: SectorPerformance) => [s.sector, s.changesPercentage]),
  );

  const treeData: TreemapItem[] = Object.entries(SECTOR_WEIGHTS)
    .map(([name, weight]) => {
      const pct = sectorMap.get(name) ?? 0;
      return { name, value: weight, pct, fill: perfColor(pct) };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">S&P 500 Sectors</h2>
      <ResponsiveContainer width="100%" height={256}>
        <Treemap data={treeData} dataKey="value" content={<CustomContent />}>
          <Tooltip content={<SectorTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import React, { useMemo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { cellColor } from '@/lib/sectorColors';
import type { MarketOverview, SectorRotationData } from '@/types';

type Index = 'sp500' | 'ftse100';

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

const CELL_GRAD_ID = 'cg-overlay';

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

const ABBREV: Record<string, string> = {
  'Consumer Discretionary': 'Cons. Disc.',
  'Consumer Staples': 'Cons. Staples',
  'Communication Services': 'Comm. Svcs',
};

function abbrev(name: string): string {
  return ABBREV[name] ?? name;
}

const CustomContent = React.memo(function CustomContent(
  props: ContentProps,
): React.JSX.Element | null {
  const { x = 0, y = 0, width = 0, height = 0, name = '', pct = 0 } = props;
  if (width < 28 || height < 22) return null;

  const base = cellColor(pct);
  const rx = 8;
  const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const label = abbrev(name);

  const showBoth = width > 64 && height > 44;
  const showPctOnly = !showBoth && width > 36 && height > 28;

  const nameFontSize = Math.max(9, Math.min(11, width / 7));
  const pctFontSize = Math.max(10, Math.min(14, width / 5.5));

  const cx = x + width / 2;
  const cy = y + height / 2;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={base}
        rx={rx}
        stroke="#f8fafc"
        strokeWidth={3}
      />
      <rect x={x} y={y} width={width} height={height} fill={`url(#${CELL_GRAD_ID})`} rx={rx} />

      {showBoth && (
        <>
          <text
            x={cx}
            y={cy - pctFontSize * 0.6}
            textAnchor="middle"
            dominantBaseline="auto"
            fill="rgba(255,255,255,0.85)"
            fontSize={nameFontSize}
            fontWeight={500}
            letterSpacing={0.2}
          >
            {label}
          </text>
          {/* Live sector data can tick between the SSR-embedded snapshot and
              client hydration — suppress the resulting (expected) mismatch
              on this text node specifically. */}
          <text
            x={cx}
            y={cy + pctFontSize * 0.85}
            textAnchor="middle"
            dominantBaseline="auto"
            fill="#ffffff"
            fontSize={pctFontSize}
            fontWeight={700}
            suppressHydrationWarning
          >
            {pctStr}
          </text>
        </>
      )}

      {showPctOnly && !showBoth && (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize={Math.max(9, Math.min(12, width / 5))}
          fontWeight={700}
          suppressHydrationWarning
        >
          {pctStr}
        </text>
      )}
    </g>
  );
});

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
      <p className={`font-medium ${pct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
        {pct >= 0 ? '+' : ''}
        {pct.toFixed(2)}%
      </p>
    </div>
  );
}

// Split into its own dynamically-imported chunk (see HomePageView.tsx) —
// recharts + its transitive deps (d3-scale/d3-shape/d3-color, redux-toolkit,
// immer, es-toolkit) are ~176 KiB of JS the homepage doesn't need until this
// specific view actually renders with real data. Confirmed via
// `next experimental-analyze` that recharts is imported nowhere else in the
// app, so none of that weight has anywhere else to hide.
export function TreemapView({
  activeIndex,
  rotationData,
  overviewData,
}: {
  activeIndex: Index;
  rotationData: SectorRotationData | undefined;
  overviewData: MarketOverview | undefined;
}): React.JSX.Element {
  const weights = activeIndex === 'ftse100' ? FTSE_WEIGHTS : SP500_WEIGHTS;

  const treeData = useMemo<TreemapItem[]>(() => {
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
    return Object.entries(weights)
      .map(([name, value]) => ({ name, value, pct: pctMap.get(name) ?? 0 }))
      .sort((a, b) => b.value - a.value);
  }, [activeIndex, rotationData, overviewData, weights]);

  if (!treeData.some((d) => d.pct !== 0)) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500">No data</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <Treemap data={treeData} dataKey="value" content={<CustomContent />}>
        {/* Gradient defined once inside the Recharts SVG, shared by all cells */}
        <defs>
          <linearGradient id={CELL_GRAD_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0.12} />
          </linearGradient>
        </defs>
        <Tooltip content={<SectorTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
}

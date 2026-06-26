'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FactorTile } from '@/types';

type Timeframe = '1d' | '1w' | '1m';

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
];

const FACTOR_DESCRIPTIONS: Record<string, string> = {
  Momentum: 'MTUM — stocks with recent strong price performance',
  Value: 'VTV — undervalued stocks relative to fundamentals',
  Growth: 'VUG — companies with above-average earnings growth',
  Dividend: 'VIG — consistent dividend growers',
  'Low Volatility': 'USMV — stocks with lower price swings',
  Quality: 'QUAL — financially strong, stable companies',
};

function changeKey(tf: Timeframe): keyof FactorTile {
  if (tf === '1w') return 'change1w';
  if (tf === '1m') return 'change1m';
  return 'change1d';
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function pctClass(n: number): string {
  return n >= 0 ? 'text-green-600' : 'text-red-600';
}

export function FactorTiles(): React.JSX.Element {
  const [tf, setTf] = useState<Timeframe>('1d');

  const { data = [], isLoading } = useQuery<FactorTile[]>({
    queryKey: ['factors'],
    queryFn: () => api.get<FactorTile[]>('/market/factors').then((r) => r.data),
    staleTime: 15 * 60 * 1000,
  });

  const primaryKey = changeKey(tf);

  const sorted = [...data].sort((a, b) => (b[primaryKey] as number) - (a[primaryKey] as number));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Factor Performance</h2>
        <div className="flex gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTf(t.id)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                tf === t.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-36 h-28 bg-gray-100 rounded-xl animate-pulse" />
          ))}

        {!isLoading &&
          sorted.map((tile) => {
            const primary = tile[primaryKey] as number;
            const secondary1 = tf === '1d' ? tile.change1w : tile.change1d;
            const secondary2 = tf === '1m' ? tile.change1w : tile.change1m;
            const sec1Label = tf === '1d' ? '1W' : '1D';
            const sec2Label = tf === '1m' ? '1W' : '1M';

            return (
              <div
                key={tile.etf}
                title={FACTOR_DESCRIPTIONS[tile.factor] ?? tile.etf}
                className="flex-shrink-0 w-36 bg-white rounded-xl border border-gray-200 p-3 hover:border-blue-200 transition-colors"
              >
                <p className="text-xs font-semibold text-gray-800 truncate">{tile.factor}</p>
                <p className="text-xs text-gray-400 mb-2">{tile.etf}</p>
                <p className={`text-lg font-bold leading-none ${pctClass(primary)}`}>
                  {fmtPct(primary)}
                </p>
                <div className="mt-2 flex gap-2 text-xs text-gray-500">
                  <span>
                    {sec1Label} <span className={pctClass(secondary1)}>{fmtPct(secondary1)}</span>
                  </span>
                  <span>
                    {sec2Label} <span className={pctClass(secondary2)}>{fmtPct(secondary2)}</span>
                  </span>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

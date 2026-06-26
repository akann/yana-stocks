'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SectorRotationData } from '@/types';

type Index = 'sp500' | 'ftse100';

const INDICES: { id: Index; label: string }[] = [
  { id: 'sp500', label: 'S&P 500' },
  { id: 'ftse100', label: 'FTSE 100' },
];

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
  const abs = Math.abs(pct);
  return abs >= 0.25 ? '#ffffff' : '#374151';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function SectorRotationHeatmap(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState<Index>('sp500');

  const { data, isLoading } = useQuery<SectorRotationData>({
    queryKey: ['sector-rotation', activeIndex],
    queryFn: () =>
      api
        .get<SectorRotationData>('/market/sectors/rotation', { params: { index: activeIndex } })
        .then((r) => r.data),
    staleTime: 3_600_000,
  });

  const isEmpty = !isLoading && (!data?.rows.length || !data.dates.length);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Sector Rotation</h2>
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

      {isLoading && <div className="h-64 bg-gray-50 animate-pulse rounded-lg" />}

      {isEmpty && !isLoading && (
        <div className="h-64 flex items-center justify-center text-sm text-gray-400">
          {activeIndex === 'ftse100'
            ? 'FTSE 100 sector rotation coming soon'
            : 'No sector data available'}
        </div>
      )}

      {!isLoading && data && data.rows.length > 0 && (
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
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AddToWatchlistButton } from '@/components/watchlist/AddToWatchlistButton';
import type { ScreenerResult } from '@/types';

const CAP_PRESETS = [
  { label: 'Any', min: undefined, max: undefined },
  { label: 'Small (<$2B)', min: undefined, max: 2_000_000_000 },
  { label: 'Mid ($2B–$10B)', min: 2_000_000_000, max: 10_000_000_000 },
  { label: 'Large (>$10B)', min: 10_000_000_000, max: undefined },
  { label: 'Mega (>$200B)', min: 200_000_000_000, max: undefined },
] as const;

const SECTORS = [
  'Technology',
  'Financials',
  'Health Care',
  'Consumer Discretionary',
  'Industrials',
  'Communication Services',
  'Consumer Staples',
  'Energy',
  'Real Estate',
  'Materials',
  'Utilities',
];

interface ScreenerFilters {
  marketCapMin?: number;
  marketCapMax?: number;
  volumeMin?: number;
  dividendYieldMin?: number;
  changeMin?: number;
  sector?: string;
}

function fmtCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtVol(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function StockScreener(): React.JSX.Element {
  const [capPreset, setCapPreset] = useState(0);
  const [volumeMin, setVolumeMin] = useState('');
  const [dividendYieldMin, setDividendYieldMin] = useState('');
  const [sector, setSector] = useState('');
  const [changeMin, setChangeMin] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appliedFilters, setAppliedFilters] = useState<ScreenerFilters>({});

  const { data, isLoading, isError } = useQuery<ScreenerResult[]>({
    queryKey: ['market-screener', appliedFilters],
    queryFn: () => {
      const params: Record<string, string | number> = { limit: 25 };
      if (appliedFilters.marketCapMin) params['marketCapMin'] = appliedFilters.marketCapMin;
      if (appliedFilters.marketCapMax) params['marketCapMax'] = appliedFilters.marketCapMax;
      if (appliedFilters.volumeMin) params['volumeMin'] = appliedFilters.volumeMin;
      if (appliedFilters.dividendYieldMin)
        params['dividendYieldMin'] = appliedFilters.dividendYieldMin;
      if (appliedFilters.changeMin) params['changeMin'] = appliedFilters.changeMin;
      if (appliedFilters.sector) params['sector'] = appliedFilters.sector;
      return api.get<ScreenerResult[]>('/market/screener', { params }).then((r) => r.data);
    },
    staleTime: 5 * 60 * 1000,
  });

  function applyFilters() {
    const preset = CAP_PRESETS[capPreset];
    setAppliedFilters({
      marketCapMin: preset?.min,
      marketCapMax: preset?.max,
      volumeMin: volumeMin ? parseInt(volumeMin.replace(/,/g, ''), 10) : undefined,
      dividendYieldMin: dividendYieldMin ? parseFloat(dividendYieldMin) : undefined,
      changeMin: changeMin ? parseFloat(changeMin) : undefined,
      sector: sector || undefined,
    });
  }

  function resetFilters() {
    setCapPreset(0);
    setVolumeMin('');
    setDividendYieldMin('');
    setSector('');
    setChangeMin('');
    setAppliedFilters({});
  }

  const inputClass =
    'w-full bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-blue-500';
  const labelClass = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Stock Screener</h2>
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          {sidebarOpen ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      <div className="flex">
        {sidebarOpen && (
          <div className="w-44 shrink-0 border-r border-gray-100 p-4 space-y-4">
            <div>
              <p className={labelClass}>Market Cap</p>
              <div className="space-y-1">
                {CAP_PRESETS.map((preset, i) => (
                  <label key={preset.label} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="capPreset"
                      checked={capPreset === i}
                      onChange={() => setCapPreset(i)}
                      className="accent-blue-600"
                    />
                    <span className="text-xs text-gray-700">{preset.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass}>Min Volume</label>
              <input
                type="text"
                value={volumeMin}
                onChange={(e) => setVolumeMin(e.target.value)}
                placeholder="e.g. 1000000"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Min Div Yield %</label>
              <input
                type="number"
                value={dividendYieldMin}
                onChange={(e) => setDividendYieldMin(e.target.value)}
                placeholder="e.g. 2"
                min="0"
                step="0.1"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Sector</label>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className={inputClass}
              >
                <option value="">Any</option>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Min Change % (Momentum)</label>
              <input
                type="number"
                value={changeMin}
                onChange={(e) => setChangeMin(e.target.value)}
                placeholder="e.g. 1"
                step="0.1"
                className={inputClass}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={applyFilters}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 rounded-md transition-colors"
              >
                Apply
              </button>
              <button
                onClick={resetFilters}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium py-1.5 rounded-md transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-x-auto min-w-0">
          {isLoading && <div className="py-12 text-center text-sm text-gray-400">Screening…</div>}

          {isError && (
            <div className="py-12 text-center text-sm text-red-500">
              Failed to load screener results
            </div>
          )}

          {!isLoading && !isError && data && (
            <>
              {data.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  No stocks match the current filters
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500 w-20">Symbol</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Name</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Price</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Chg %</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 hidden md:table-cell">
                        Mkt Cap
                      </th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 hidden lg:table-cell">
                        Volume
                      </th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 hidden lg:table-cell">
                        Div %
                      </th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => {
                      const positive = row.changesPercentage >= 0;
                      return (
                        <tr
                          key={row.symbol}
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/stocks/${row.symbol}`}
                              className="font-mono font-semibold text-blue-600 hover:underline"
                            >
                              {row.symbol}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-gray-700 truncate max-w-[140px]">
                            {row.name}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-900 font-medium tabular-nums">
                            ${row.price.toFixed(2)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-medium tabular-nums ${positive ? 'text-green-600' : 'text-red-600'}`}
                          >
                            {fmtPct(row.changesPercentage)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-500 text-xs hidden md:table-cell tabular-nums">
                            {fmtCap(row.marketCap)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-500 text-xs hidden lg:table-cell tabular-nums">
                            {fmtVol(row.volume)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-500 text-xs hidden lg:table-cell tabular-nums">
                            {row.dividendYield > 0
                              ? `${(row.dividendYield * 100).toFixed(2)}%`
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <AddToWatchlistButton symbol={row.symbol} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

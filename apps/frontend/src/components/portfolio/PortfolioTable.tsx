'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { Portfolio, StockAggregate } from '@/types';

interface Props {
  portfolio: Portfolio;
  livePrices: Record<string, StockAggregate | undefined>;
  onAddStock: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

function pct(value: number, cost: number): number {
  return cost > 0 ? (value / cost) * 100 : 0;
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PnlCell({ pnl, pnlPct }: { pnl: number; pnlPct: number }) {
  const pos = pnl >= 0;
  return (
    <div className={pos ? 'text-green-600' : 'text-red-600'}>
      <span className="font-medium">
        {pos ? '+' : '−'}${fmtUsd(Math.abs(pnl))}
      </span>
      <span className="block text-xs opacity-75">
        {pos ? '+' : '−'}
        {Math.abs(pnlPct).toFixed(2)}%
      </span>
    </div>
  );
}

export function PortfolioTable({
  portfolio,
  livePrices,
  onAddStock,
  onDelete,
  isDeleting = false,
}: Props): React.JSX.Element {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Compute per-holding and portfolio-level totals using live prices
  const enriched = portfolio.stocks.map((h) => {
    const agg = livePrices[h.symbol];
    const livePrice = agg?.price ?? null;
    const costBasis = h.avgCostBasis * h.shares;
    const mktValue = (livePrice ?? h.avgCostBasis) * h.shares;
    const pnl = mktValue - costBasis;
    const pnlPct = pct(pnl, costBasis);
    return { ...h, livePrice, changePercent: agg?.changePercent ?? null, mktValue, pnl, pnlPct };
  });

  const totalMktValue = enriched.reduce((s, h) => s + h.mktValue, 0);
  const totalCost = enriched.reduce((s, h) => s + h.avgCostBasis * h.shares, 0);
  const totalPnl = totalMktValue - totalCost;
  const totalPnlPct = pct(totalPnl, totalCost);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* ── Card header ── */}
      <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{portfolio.name}</h3>
          {enriched.length > 0 && (
            <span className="text-sm text-gray-500 shrink-0">
              ${fmtUsd(totalMktValue)}
              <span
                className={clsx(
                  'ml-2 text-xs font-medium',
                  totalPnl >= 0 ? 'text-green-600' : 'text-red-600',
                )}
              >
                {totalPnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(totalPnl))} (
                {totalPnl >= 0 ? '+' : '−'}
                {Math.abs(totalPnlPct).toFixed(2)}%)
              </span>
            </span>
          )}
        </div>

        {/* Delete control */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500">Delete portfolio?</span>
            <button
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
              disabled={isDeleting}
              className="text-xs text-red-600 hover:text-red-300 font-medium disabled:opacity-50"
            >
              {isDeleting ? 'Deleting…' : 'Yes'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-500 hover:text-gray-500"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-500 hover:text-red-600 transition-colors shrink-0"
            title="Delete portfolio"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        )}
      </div>

      {/* ── Holdings table ── */}
      {enriched.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="text-left px-5 py-2.5 font-medium">Symbol</th>
                  <th className="text-right px-4 py-2.5 font-medium">Shares</th>
                  <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">
                    Avg Cost
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium">Live Price</th>
                  <th className="text-right px-4 py-2.5 font-medium hidden md:table-cell">Day %</th>
                  <th className="text-right px-4 py-2.5 font-medium hidden lg:table-cell">
                    Mkt Value
                  </th>
                  <th className="text-right px-5 py-2.5 font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((h) => (
                  <tr
                    key={h.symbol}
                    onClick={() => router.push(`/stocks/${h.symbol}`)}
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-100/60 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5 font-semibold text-blue-600 font-mono">
                      {h.symbol}
                    </td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums">
                      {h.shares}
                    </td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums hidden sm:table-cell">
                      ${fmtUsd(h.avgCostBasis)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {h.livePrice != null ? (
                        <span className="text-gray-900 font-medium">${fmtUsd(h.livePrice)}</span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums hidden md:table-cell">
                      {h.changePercent != null ? (
                        <span
                          className={clsx(
                            'text-xs font-medium',
                            h.changePercent >= 0 ? 'text-green-600' : 'text-red-600',
                          )}
                        >
                          {h.changePercent >= 0 ? '+' : ''}
                          {h.changePercent.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-gray-500 tabular-nums hidden lg:table-cell">
                      ${fmtUsd(h.mktValue)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      <PnlCell pnl={h.pnl} pnlPct={h.pnlPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-100/30 text-xs text-gray-500">
                  <td className="px-5 py-2.5 font-medium text-gray-500" colSpan={2}>
                    Total ({enriched.length} holding{enriched.length !== 1 ? 's' : ''})
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden md:table-cell" />
                  <td className="px-4 py-2.5 text-right text-gray-500 font-medium hidden lg:table-cell">
                    ${fmtUsd(totalMktValue)}
                  </td>
                  <td />
                  <td className="px-5 py-2.5 text-right">
                    <PnlCell pnl={totalPnl} pnlPct={totalPnlPct} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <div className="px-5 py-10 text-center text-gray-500 text-sm">No holdings yet.</div>
      )}

      {/* ── Add Stock footer ── */}
      <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddStock();
          }}
          className="text-sm text-blue-600 hover:text-blue-300 font-medium transition-colors"
        >
          + Add Stock
        </button>
      </div>
    </div>
  );
}

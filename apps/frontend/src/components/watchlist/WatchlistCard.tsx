'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AddToWatchlistButton } from './AddToWatchlistButton';
import { SymbolAutocompleteInput } from '@/components/SymbolAutocompleteInput';
import type { StockAggregate, Watchlist } from '@/types';

interface Props {
  watchlist: Watchlist;
  livePrices: Record<string, StockAggregate | undefined>;
  onDelete: () => void;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  isDeleting?: boolean;
  removingSymbol?: string | null;
}

function SentimentBadge({ label }: { label: string }) {
  return (
    <span
      className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', {
        'bg-green-50 text-green-600': label === 'positive',
        'bg-red-50 text-red-600': label === 'negative',
        'bg-gray-200 text-gray-600': label === 'neutral',
      })}
    >
      {label}
    </span>
  );
}

export function WatchlistCard({
  watchlist,
  livePrices,
  onDelete,
  onAddSymbol,
  onRemoveSymbol,
  isDeleting = false,
  removingSymbol = null,
}: Props): React.JSX.Element {
  const router = useRouter();
  const [addInput, setAddInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    onAddSymbol(sym);
    setAddInput('');
    setShowAdd(false);
  }

  return (
    // overflow must stay visible so the add-symbol autocomplete dropdown can escape the card
    <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl">
      {/* ── Header ── */}
      <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{watchlist.name}</h3>
          <span className="text-xs text-gray-600 shrink-0">
            {watchlist.symbols.length} symbol{watchlist.symbols.length !== 1 ? 's' : ''}
          </span>
        </div>

        {confirmDelete ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-600">Delete?</span>
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
              className="text-xs text-gray-600 hover:text-gray-600"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-600 hover:text-red-600 transition-colors shrink-0"
            title="Delete watchlist"
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

      {/* ── Symbol table ── */}
      {watchlist.symbols.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase tracking-wider border-b border-gray-200">
                <th className="text-left px-5 py-2.5 font-medium">Symbol</th>
                <th className="text-right px-4 py-2.5 font-medium">Price</th>
                <th className="text-right px-4 py-2.5 font-medium">Change</th>
                <th className="text-right px-4 py-2.5 font-medium hidden sm:table-cell">Day %</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">
                  Sentiment
                </th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {watchlist.symbols.map((sym) => {
                const agg = livePrices[sym];
                const isRemoving = removingSymbol === sym;
                const dayPos = (agg?.changePercent ?? 0) >= 0;

                return (
                  <tr
                    key={sym}
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-100/50 transition-colors"
                  >
                    <td
                      className="px-5 py-3.5 font-semibold text-blue-600 font-mono cursor-pointer"
                      onClick={() => router.push(`/stocks/${sym}`)}
                    >
                      {sym}
                    </td>

                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {agg?.price != null ? (
                        <span className="text-gray-900 font-medium">${agg.price.toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {agg?.change != null ? (
                        <span className={dayPos ? 'text-green-600' : 'text-red-600'}>
                          {dayPos ? '+' : ''}${agg.change.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right tabular-nums hidden sm:table-cell">
                      {agg?.changePercent != null ? (
                        <span
                          className={clsx(
                            'text-xs font-medium',
                            dayPos ? 'text-green-600' : 'text-red-600',
                          )}
                        >
                          {dayPos ? '+' : ''}
                          {agg.changePercent.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 hidden md:table-cell">
                      {agg?.sentiment?.label ? (
                        <SentimentBadge label={agg.sentiment.label} />
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <AddToWatchlistButton symbol={sym} excludeWatchlistId={watchlist.id} />
                        <button
                          onClick={() => onRemoveSymbol(sym)}
                          disabled={isRemoving}
                          className="text-gray-600 hover:text-red-600 transition-colors disabled:opacity-30"
                          title={`Remove ${sym}`}
                        >
                          {isRemoving ? (
                            <span className="text-xs">…</span>
                          ) : (
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-600 text-sm px-5 py-8 text-center">
          No symbols yet — add one below.
        </p>
      )}

      {/* ── Add symbol footer ── */}
      <div className="px-5 py-3 border-t border-gray-200">
        {showAdd ? (
          <form onSubmit={handleAddSubmit} className="flex gap-2">
            <SymbolAutocompleteInput
              autoFocus
              value={addInput}
              onChange={(v) => setAddInput(v.toUpperCase())}
              placeholder="Symbol (e.g. AAPL)"
              maxLength={10}
              className="flex-1"
              inputClassName="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 uppercase"
            />
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setAddInput('');
              }}
              className="text-gray-600 hover:text-gray-600 text-sm px-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              Add
            </button>
          </form>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm text-blue-600 hover:text-blue-300 font-medium transition-colors"
          >
            + Add Symbol
          </button>
        )}
      </div>
    </div>
  );
}

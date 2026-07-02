'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AssetsPage } from '@/types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Applied to the relative wrapper (e.g. `flex-1`) */
  className?: string;
  /** Applied to the <input> itself — caller owns the field styling */
  inputClassName?: string;
  autoFocus?: boolean;
  maxLength?: number;
}

/**
 * Controlled symbol input with the same debounced /market/assets autocomplete
 * as the navbar SymbolSearch, but it fills the input instead of navigating —
 * for forms that add a symbol to a watchlist or portfolio.
 */
export function SymbolAutocompleteInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  autoFocus,
  maxLength,
}: Props): React.JSX.Element {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(value), 250);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const { data } = useQuery<AssetsPage>({
    // Same key + params as the navbar SymbolSearch so results share the cache
    queryKey: ['symbol-search', debouncedQuery],
    queryFn: () =>
      api
        .get<AssetsPage>('/market/assets', {
          params: { search: debouncedQuery, limit: 8, market: 'all' },
        })
        .then((r) => r.data),
    enabled: debouncedQuery.length >= 1,
    staleTime: 60_000,
  });

  const results = data?.data ?? [];

  function select(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length > 0 ? Math.min(i + 1, results.length - 1) : i));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      // Only intercept Enter to pick a highlighted suggestion; otherwise let
      // the surrounding form submit as usual
      if (open && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        select(results[activeIndex].symbol);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const showDropdown = open && results.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <input
        autoFocus={autoFocus}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (value.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        className={inputClassName}
      />

      {showDropdown && (
        <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden z-50">
          {results.map((asset, i) => (
            <li key={asset.symbol}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(asset.symbol);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors ${
                  i === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="font-mono font-semibold text-sm text-gray-900 w-16 shrink-0">
                  {asset.symbol}
                </span>
                <span className="text-xs text-gray-500 truncate">{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

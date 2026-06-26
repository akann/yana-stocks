'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AssetsPage } from '@/types';

export function SymbolSearch(): React.JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

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

  function navigate(symbol: string) {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    router.push(`/stocks/${symbol}`);
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
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        navigate(results[activeIndex].symbol);
      } else if (query.trim()) {
        navigate(query.trim().toUpperCase());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && results.length > 0;

  return (
    <div ref={containerRef} className="relative hidden md:block w-52">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (query.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search symbol…"
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-gray-100 text-gray-900 placeholder-gray-500 text-sm rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all uppercase"
      />
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>

      {showDropdown && (
        <ul className="absolute left-0 right-0 top-full mt-1 bg-[#1B2A4A] border border-[#0D1A30] rounded-lg shadow-xl overflow-hidden z-50">
          {results.map((asset, i) => (
            <li key={asset.symbol}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigate(asset.symbol);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors ${
                  i === activeIndex ? 'bg-blue-600' : 'hover:bg-white/10'
                }`}
              >
                <span className="font-mono font-semibold text-sm text-white w-16 shrink-0">
                  {asset.symbol}
                </span>
                <span className="text-xs text-gray-400 truncate">{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

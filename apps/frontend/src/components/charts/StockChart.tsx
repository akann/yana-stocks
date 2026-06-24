'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type Time,
} from 'lightweight-charts';
import { api } from '@/lib/api';
import type { OHLCVBar } from '@/types';

const RANGES = [
  { label: '1H', limit: 60, interval: '1m' },
  { label: '1D', limit: 390, interval: '1m' },
  { label: '1W', limit: 5, interval: '1d' },
  { label: '1M', limit: 21, interval: '1d' },
  { label: '3M', limit: 63, interval: '1d' },
  { label: '6M', limit: 126, interval: '1d' },
  { label: '1Y', limit: 252, interval: '1d' },
] as const;
type RangeLabel = (typeof RANGES)[number]['label'];
type ChartType = 'candlestick' | 'line';

interface Props {
  symbol: string;
  currentPrice?: number | null;
}

function toTime(timestamp: string, isDaily: boolean): Time {
  if (isDaily) return timestamp.slice(0, 10) as Time;
  return Math.floor(new Date(timestamp).getTime() / 1000) as Time;
}

function sortBars(bars: OHLCVBar[]): OHLCVBar[] {
  return [...bars].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function StockChart({ symbol, currentPrice }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Closure registered during chart init; called with sorted bars + current price
  const updateDataRef = useRef<((bars: OHLCVBar[], currPrice: number | null) => void) | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);

  const [range, setRange] = useState<RangeLabel>('1W');
  const [chartType, setChartType] = useState<ChartType>('candlestick');

  const activeRange = RANGES.find((r) => r.label === range)!;
  const isDaily = activeRange.interval === '1d';

  const { data, isLoading } = useQuery<OHLCVBar[]>({
    queryKey: ['history', symbol, activeRange.limit, activeRange.interval],
    queryFn: () =>
      api
        .get<
          OHLCVBar[]
        >(`/stocks/${symbol}/history?limit=${activeRange.limit}&interval=${activeRange.interval}`)
        .then((r) => r.data),
    refetchInterval: isDaily ? 3_600_000 : 30_000,
    staleTime: isDaily ? 300_000 : 10_000,
  });

  // Chart init — recreate on chart type or interval change (not on data)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    chartRef.current?.remove();
    chartRef.current = null;
    updateDataRef.current = null;
    priceLineRef.current = null;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: '#f2f5f7' },
        textColor: '#4b5563',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: '#e5e7eb' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'transparent' },
      timeScale: {
        borderColor: 'transparent',
        timeVisible: !isDaily,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    // Volume pane (pane index 1) — 20% height relative to price pane
    const volumePane = chart.addPane();
    volumePane.setStretchFactor(1);
    chart.panes()[0]?.setStretchFactor(4);

    // Volume histogram (price scale hidden on volume pane)
    volumePane.priceScale('right').applyOptions({ visible: false });
    volumePane.priceScale('left').applyOptions({ visible: false });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        color: 'rgba(148, 163, 184, 0.5)',
        priceFormat: { type: 'volume' },
        priceScaleId: 'right',
      },
      1,
    );

    if (chartType === 'candlestick') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      updateDataRef.current = (bars, currPrice) => {
        const sorted = sortBars(bars);

        candleSeries.setData(
          sorted.map((bar) => ({
            time: toTime(bar.timestamp, isDaily),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })),
        );

        volumeSeries.setData(
          sorted.map((bar) => ({
            time: toTime(bar.timestamp, isDaily),
            value: bar.volume,
            color: bar.close >= bar.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
          })),
        );

        chart.timeScale().fitContent();

        // Reference price line
        if (priceLineRef.current) {
          candleSeries.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        }
        if (currPrice != null) {
          priceLineRef.current = candleSeries.createPriceLine({
            price: currPrice,
            color: '#3b82f6',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `$${currPrice.toFixed(2)}`,
          });
        }
      };
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: '#22c55e',
        topColor: 'rgba(34, 197, 94, 0.25)',
        bottomColor: 'rgba(34, 197, 94, 0)',
        lineWidth: 2,
      });

      updateDataRef.current = (bars, currPrice) => {
        const sorted = sortBars(bars);
        const first = sorted[0]?.close ?? 0;
        const last = sorted[sorted.length - 1]?.close ?? 0;
        const isUp = last >= first;
        const color = isUp ? '#22c55e' : '#ef4444';

        areaSeries.applyOptions({
          lineColor: color,
          topColor: isUp ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        });

        areaSeries.setData(
          sorted.map((bar) => ({
            time: toTime(bar.timestamp, isDaily),
            value: bar.close,
          })),
        );

        volumeSeries.setData(
          sorted.map((bar) => ({
            time: toTime(bar.timestamp, isDaily),
            value: bar.volume,
            color: bar.close >= bar.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
          })),
        );

        chart.timeScale().fitContent();

        if (priceLineRef.current) {
          areaSeries.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        }
        if (currPrice != null) {
          priceLineRef.current = areaSeries.createPriceLine({
            price: currPrice,
            color: '#3b82f6',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `$${currPrice.toFixed(2)}`,
          });
        }
      };
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      updateDataRef.current = null;
      priceLineRef.current = null;
    };
  }, [chartType, isDaily]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data + currentPrice update — runs whenever data or currentPrice changes
  useEffect(() => {
    if (!data?.length || !updateDataRef.current) return;
    updateDataRef.current(data, currentPrice ?? null);
  }, [data, currentPrice]);

  return (
    <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
      {/* Controls */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Price Chart
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Chart type toggle */}
          <div className="flex gap-1">
            {(['line', 'candlestick'] as ChartType[]).map((type) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  chartType === type
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {type === 'line' ? 'Line' : 'Candle'}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-gray-200" />

          {/* Range buttons */}
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setRange(r.label)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  range === r.label
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart area — always mounted so the ref is stable */}
      <div className="relative">
        <div ref={containerRef} className="w-full" />

        {isLoading && (
          <div className="absolute inset-0 animate-pulse bg-gray-100 rounded-lg h-[360px]" />
        )}

        {!isLoading && !data?.length && (
          <div className="h-[360px] flex items-center justify-center text-gray-500 text-sm">
            No price history available
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
// v5.2.0 + shared-valid-set fix
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type IPriceLine,
} from 'lightweight-charts';
import { api } from '@/lib/api';
import { computeMA, computeMACD, computeRSI, sortBars, toTime } from '@/lib/chart-utils';
import { detectSignals, type ChartSignal, type MAConfig } from '@/lib/signals';
import { type NewsArticle } from '@/components/news/NewsPanel';
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

const MA_CONFIGS = [
  { key: 'SMA20', type: 'sma' as const, period: 20, color: '#3b82f6', label: 'SMA 20' },
  { key: 'SMA50', type: 'sma' as const, period: 50, color: '#f97316', label: 'SMA 50' },
  { key: 'SMA200', type: 'sma' as const, period: 200, color: '#a855f7', label: 'SMA 200' },
  { key: 'EMA12', type: 'ema' as const, period: 12, color: '#10b981', label: 'EMA 12' },
  { key: 'EMA26', type: 'ema' as const, period: 26, color: '#f43f5e', label: 'EMA 26' },
] as const;
type MAKey = (typeof MA_CONFIGS)[number]['key'];

interface Props {
  symbol: string;
  currentPrice?: number | null;
}

function buildMarkers(
  signals: ChartSignal[],
  newsArticles: NewsArticle[],
  clean: OHLCVBar[],
  isDaily: boolean,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  for (const s of signals) {
    if (s.source !== 'ma-cross') continue;
    markers.push({
      time: s.time,
      position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: s.type === 'buy' ? '#22c55e' : '#ef4444',
      shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
      size: 1,
    });
  }

  // News markers on daily charts only — intraday minute-snapping is unreliable
  if (isDaily && newsArticles.length > 0) {
    const barDates = new Set(clean.map((b) => b.timestamp.slice(0, 10)));
    for (const a of newsArticles) {
      const date = a.publishedAt.slice(0, 10);
      if (!barDates.has(date)) continue;
      markers.push({
        time: date as Time,
        position: 'aboveBar',
        color:
          a.sentimentLabel === 'positive'
            ? '#22c55e'
            : a.sentimentLabel === 'negative'
              ? '#ef4444'
              : '#9ca3af',
        shape: 'circle',
        size: 1,
      });
    }
  }

  // lightweight-charts requires markers sorted by time
  return markers.sort((a, b) => {
    const n = (t: Time) => (typeof t === 'string' ? new Date(t).getTime() : Number(t));
    return n(a.time) - n(b.time);
  });
}

export function StockChart({ symbol, currentPrice }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const updateDataRef = useRef<((bars: OHLCVBar[], currPrice: number | null) => void) | null>(null);
  const updateMAsRef = useRef<((sorted: OHLCVBar[], enabled: Set<MAKey>) => void) | null>(null);
  const updateRSIRef = useRef<
    ((sorted: OHLCVBar[], show: boolean, macdVisible: boolean) => void) | null
  >(null);
  const updateMACDRef = useRef<
    ((sorted: OHLCVBar[], show: boolean, rsiVisible: boolean) => void) | null
  >(null);
  const updateMarkersRef = useRef<
    ((signals: ChartSignal[], news: NewsArticle[], clean: OHLCVBar[]) => void) | null
  >(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesMapRef = useRef<Map<MAKey, ISeriesApi<'Line'>>>(new Map());

  const [range, setRange] = useState<RangeLabel>('1W');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [enabledMAs, setEnabledMAs] = useState<Set<MAKey>>(new Set());
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const activeRange = RANGES.find((r) => r.label === range)!;
  const isDaily = activeRange.interval === '1d';

  const activeMaConfigs = useMemo<MAConfig[]>(
    () =>
      MA_CONFIGS.filter((c) => enabledMAs.has(c.key as MAKey)).map(({ key, type, period }) => ({
        key,
        type,
        period,
      })),
    [enabledMAs],
  );

  const { data: news = [] } = useQuery<NewsArticle[]>({
    queryKey: ['news', symbol],
    queryFn: () => api.get<NewsArticle[]>(`/news/${symbol}`).then((r) => r.data),
    staleTime: 300_000,
  });

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

  // Chart setup — recreate on chart type or interval change (not on data or MAs)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Capture the map reference so the cleanup closure uses a stable value
    const maSeriesMap = maSeriesMapRef.current;

    chartRef.current?.remove();
    chartRef.current = null;
    updateDataRef.current = null;
    updateMAsRef.current = null;
    updateRSIRef.current = null;
    updateMACDRef.current = null;
    updateMarkersRef.current = null;
    priceLineRef.current = null;
    volSeriesRef.current = null;
    rsiSeriesRef.current = null;
    macdLineSeriesRef.current = null;
    macdSignalSeriesRef.current = null;
    macdHistSeriesRef.current = null;
    maSeriesMap.clear();

    const chart = createChart(el, {
      width: el.clientWidth || 600,
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
        minBarSpacing: 2,
      },
    });
    chartRef.current = chart;

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volSeriesRef.current = volSeries;

    // MA series management — called from the data/MA effects
    updateMAsRef.current = (sorted: OHLCVBar[], enabled: Set<MAKey>) => {
      // Remove series that are no longer enabled
      for (const [key, series] of maSeriesMapRef.current) {
        if (!enabled.has(key)) {
          chart.removeSeries(series);
          maSeriesMapRef.current.delete(key);
        }
      }
      // Add / update enabled series
      for (const cfg of MA_CONFIGS) {
        if (!enabled.has(cfg.key)) continue;
        const maData = computeMA(sorted, cfg.type, cfg.period, isDaily);
        if (maData.length === 0) continue;

        let series = maSeriesMapRef.current.get(cfg.key);
        if (!series) {
          series = chart.addSeries(LineSeries, {
            color: cfg.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          maSeriesMapRef.current.set(cfg.key, series);
        }
        series.setData(maData);
      }
    };

    // Centrally manages all price-scale margins based on which sub-panes are active.
    // Called after any indicator is added/removed so all scales stay consistent.
    //
    // Layout (% of chart height):
    //   none:      price ~100%, vol overlay
    //   one pane:  price ~69%, vol 12%, indicator 13%
    //   two panes: price ~56%, vol 12%, RSI 13%, MACD 12%
    const applyAllMargins = (rsiOn: boolean, macdOn: boolean) => {
      if (!rsiOn && !macdOn) {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      } else if (rsiOn && !macdOn) {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.27 } });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.74, bottom: 0.14 } });
        if (rsiSeriesRef.current) {
          chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
        }
      } else if (!rsiOn && macdOn) {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.27 } });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.74, bottom: 0.14 } });
        if (macdHistSeriesRef.current) {
          chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
        }
      } else {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.4 } });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.61, bottom: 0.27 } });
        if (rsiSeriesRef.current) {
          chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.74, bottom: 0.13 } });
        }
        if (macdHistSeriesRef.current) {
          chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
        }
      }
    };

    updateRSIRef.current = (sorted: OHLCVBar[], show: boolean, macdVisible: boolean) => {
      if (!show) {
        if (rsiSeriesRef.current) {
          chart.removeSeries(rsiSeriesRef.current);
          rsiSeriesRef.current = null;
        }
        applyAllMargins(false, macdVisible);
        return;
      }

      const rsiData = computeRSI(sorted, 14, isDaily);
      if (rsiData.length === 0) return;

      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'rsi',
          color: '#8b5cf6',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
            margins: { above: 0.08, below: 0.08 },
          }),
        });
        rsiSeriesRef.current.createPriceLine({
          price: 70,
          color: 'rgba(239, 68, 68, 0.6)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        rsiSeriesRef.current.createPriceLine({
          price: 30,
          color: 'rgba(34, 197, 94, 0.6)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
      }

      rsiSeriesRef.current.setData(rsiData);
      applyAllMargins(true, macdVisible);
    };

    updateMACDRef.current = (sorted: OHLCVBar[], show: boolean, rsiVisible: boolean) => {
      if (!show) {
        if (macdHistSeriesRef.current) {
          chart.removeSeries(macdHistSeriesRef.current);
          macdHistSeriesRef.current = null;
        }
        if (macdLineSeriesRef.current) {
          chart.removeSeries(macdLineSeriesRef.current);
          macdLineSeriesRef.current = null;
        }
        if (macdSignalSeriesRef.current) {
          chart.removeSeries(macdSignalSeriesRef.current);
          macdSignalSeriesRef.current = null;
        }
        applyAllMargins(rsiVisible, false);
        return;
      }

      const { macdLine, signalLine, histogram } = computeMACD(sorted, 12, 26, 9, isDaily);
      if (macdLine.length === 0) return;

      if (!macdHistSeriesRef.current) {
        // Histogram first so it renders behind the lines
        macdHistSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceScaleId: 'macd',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        macdHistSeriesRef.current.createPriceLine({
          price: 0,
          color: 'rgba(107,114,128,0.4)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        macdLineSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: '#3b82f6',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        macdSignalSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: '#f97316',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }

      macdHistSeriesRef.current.setData(histogram);
      macdLineSeriesRef.current?.setData(macdLine);
      macdSignalSeriesRef.current?.setData(signalLine);
      applyAllMargins(rsiVisible, true);
    };

    let markerPlugin: ISeriesMarkersPluginApi<Time> | null = null;

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

        // Both series must share the exact same time points — any bar present in
        // one but absent in the other leaves a "hole" in the shared time scale
        // index space, causing ensureNotNull() to crash at render time.
        const valid = sorted.filter((d) => {
          const o = Number(d.open);
          const h = Number(d.high);
          const l = Number(d.low);
          const c = Number(d.close);
          return (
            d.open != null &&
            d.high != null &&
            d.low != null &&
            d.close != null &&
            !isNaN(o) &&
            !isNaN(h) &&
            !isNaN(l) &&
            !isNaN(c)
          );
        });

        candleSeries.setData(
          valid.map((d) => ({
            time: toTime(d.timestamp, isDaily),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
          })),
        );

        volSeries.setData(
          valid.map((d) => ({
            time: toTime(d.timestamp, isDaily),
            value: Number(d.volume) || 0,
            color:
              Number(d.close) >= Number(d.open) ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
          })),
        );

        chart.timeScale().fitContent();

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

      updateMarkersRef.current = (signals, newsArticles, clean) => {
        const markers = buildMarkers(signals, newsArticles, clean, isDaily);
        if (markerPlugin) {
          markerPlugin.setMarkers(markers);
        } else if (markers.length > 0) {
          markerPlugin = createSeriesMarkers(candleSeries, markers);
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
        const valid = sorted.filter((d) => {
          const c = Number(d.close);
          return d.close != null && !isNaN(c);
        });

        const first = Number(valid[0]?.close) ?? 0;
        const last = Number(valid[valid.length - 1]?.close) ?? 0;
        const isUp = last >= first;
        const color = isUp ? '#22c55e' : '#ef4444';

        areaSeries.applyOptions({
          lineColor: color,
          topColor: isUp ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        });

        areaSeries.setData(
          valid.map((d) => ({
            time: toTime(d.timestamp, isDaily),
            value: Number(d.close),
          })),
        );

        volSeries.setData(
          valid.map((d) => ({
            time: toTime(d.timestamp, isDaily),
            value: Number(d.volume) || 0,
            color: isUp ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
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

      updateMarkersRef.current = (signals, newsArticles, clean) => {
        const markers = buildMarkers(signals, newsArticles, clean, isDaily);
        if (markerPlugin) {
          markerPlugin.setMarkers(markers);
        } else if (markers.length > 0) {
          markerPlugin = createSeriesMarkers(areaSeries, markers);
        }
      };
    }

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      markerPlugin?.detach();
      chart.remove();
      chartRef.current = null;
      updateDataRef.current = null;
      updateMAsRef.current = null;
      updateRSIRef.current = null;
      updateMACDRef.current = null;
      updateMarkersRef.current = null;
      priceLineRef.current = null;
      volSeriesRef.current = null;
      rsiSeriesRef.current = null;
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistSeriesRef.current = null;
      maSeriesMap.clear();
    };
  }, [chartType, isDaily]);

  // Data, price, and MA update — all driven by the same effect to keep series in sync
  useEffect(() => {
    if (!data?.length || !updateDataRef.current) return;
    const sorted = sortBars(data);
    // Defensive dedup: MongoDB may have multiple docs per trading day from different
    // UTC offsets. Reverse → first-seen wins → reverse back keeps last (highest UTC) per key.
    const seenTs = new Set<string | number>();
    const clean = sorted
      .slice()
      .reverse()
      .filter((d) => {
        const t = toTime(d.timestamp, isDaily) as string | number;
        if (seenTs.has(t)) return false;
        seenTs.add(t);
        return true;
      })
      .reverse();
    updateDataRef.current(clean, currentPrice ?? null);
    updateMAsRef.current?.(clean, enabledMAs);
    updateRSIRef.current?.(clean, showRSI, showMACD);
    updateMACDRef.current?.(clean, showMACD, showRSI);
    const signalsForMarkers = detectSignals(clean, isDaily, showRSI, showMACD, activeMaConfigs);
    updateMarkersRef.current?.(signalsForMarkers, news, clean);
  }, [
    data,
    currentPrice,
    enabledMAs,
    showRSI,
    showMACD,
    isDaily,
    chartType,
    news,
    activeMaConfigs,
  ]);

  function toggleMA(key: MAKey) {
    setEnabledMAs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Signal badges derived from current data + active indicator state — no new API calls.
  const chartSignals = useMemo<ChartSignal[]>(() => {
    if (!data?.length) return [];
    const sorted = sortBars(data);
    const seen = new Set<string | number>();
    const clean = sorted
      .slice()
      .reverse()
      .filter((d) => {
        const t = toTime(d.timestamp, isDaily) as string | number;
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .reverse();
    return detectSignals(clean, isDaily, showRSI, showMACD, activeMaConfigs);
  }, [data, isDaily, showRSI, showMACD, activeMaConfigs]);

  // Collapse badges: one badge per source+type, with ×N count when N > 1.
  const signalBadges = useMemo(() => {
    const groups = new Map<string, { signal: ChartSignal; count: number }>();
    for (const s of chartSignals) {
      const key = `${s.source}-${s.type}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { signal: s, count: 1 });
    }
    return Array.from(groups.values());
  }, [chartSignals]);

  return (
    <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-4">
      {/* Controls */}
      <div className="flex flex-col gap-2 mb-3">
        {/* Row 1: title + signal badges (left) | chart type toggle (right) */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            Price Chart
            {signalBadges.map(({ signal: s, count }) => (
              <span
                key={`${s.source}-${s.type}`}
                title={count > 1 ? `${count} crossovers — ${s.description}` : s.description}
                className={`text-xs px-1.5 py-0.5 rounded font-medium normal-case tracking-normal ${
                  s.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {s.source === 'rsi'
                  ? s.type === 'buy'
                    ? 'Oversold'
                    : 'Overbought'
                  : s.source === 'macd'
                    ? s.type === 'buy'
                      ? `↑ MACD${count > 1 ? ` ×${count}` : ''}`
                      : `↓ MACD${count > 1 ? ` ×${count}` : ''}`
                    : s.type === 'buy'
                      ? `↑ MA Cross${count > 1 ? ` ×${count}` : ''}`
                      : `↓ MA Cross${count > 1 ? ` ×${count}` : ''}`}
              </span>
            ))}
          </h3>
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
        </div>

        {/* Row 2: timeframe buttons */}
        <div className="flex items-center gap-1 -ml-2.5">
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

        {/* Indicator toggles — MAs + RSI */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 font-medium mr-0.5">MA</span>
          {MA_CONFIGS.map((cfg) => {
            const active = enabledMAs.has(cfg.key);
            return (
              <button
                key={cfg.key}
                onClick={() => toggleMA(cfg.key)}
                className={`px-2 py-0.5 text-xs rounded font-medium transition-colors border ${
                  active
                    ? 'text-white'
                    : 'text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }`}
                style={active ? { backgroundColor: cfg.color, borderColor: cfg.color } : undefined}
              >
                {cfg.label}
              </button>
            );
          })}

          <div className="w-px h-3 bg-gray-200 mx-0.5" />

          <button
            onClick={() => setShowRSI((v) => !v)}
            className={`px-2 py-0.5 text-xs rounded font-medium transition-colors border ${
              showRSI
                ? 'text-white border-[#8b5cf6]'
                : 'text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
            }`}
            style={showRSI ? { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' } : undefined}
          >
            RSI 14
          </button>

          <button
            onClick={() => setShowMACD((v) => !v)}
            className={`px-2 py-0.5 text-xs rounded font-medium transition-colors border ${
              showMACD
                ? 'text-white border-[#f59e0b]'
                : 'text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
            }`}
            style={showMACD ? { backgroundColor: '#f59e0b', borderColor: '#f59e0b' } : undefined}
          >
            MACD
          </button>
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

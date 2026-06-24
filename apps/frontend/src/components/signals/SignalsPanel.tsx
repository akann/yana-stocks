'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import type { PredictionHorizon, PredictionSignal, SentimentSignal } from '@/types';

interface SignalsResponse {
  symbol: string;
  sentiment: SentimentSignal | null;
  prediction: PredictionSignal | null;
}

interface PredictResponse {
  symbol: string;
  predictions: PredictionSignal[];
}

const HORIZON_LABELS: Record<PredictionHorizon, string> = {
  '1h': '1 Hour',
  '4h': '4 Hours',
  '1d': '1 Day',
  '1w': '1 Week',
};

export function SignalsPanel({ symbol }: { symbol: string }): React.JSX.Element {
  const { data: signals } = useQuery<SignalsResponse>({
    queryKey: ['signals', symbol],
    queryFn: () => api.get<SignalsResponse>(`/signals/${symbol}`).then((r) => r.data),
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: predictions } = useQuery<PredictResponse>({
    queryKey: ['predict', symbol],
    queryFn: () => api.get<PredictResponse>(`/predict/${symbol}`).then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  });

  const sentiment = signals?.sentiment;
  const predList = predictions?.predictions ?? [];

  return (
    <div className="space-y-4">
      {/* Sentiment */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Sentiment
        </h3>
        {sentiment ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span
                className={clsx('text-sm font-semibold capitalize px-2 py-0.5 rounded', {
                  'bg-green-50 text-green-600': sentiment.label === 'positive',
                  'bg-red-50 text-red-600': sentiment.label === 'negative',
                  'bg-gray-200 text-gray-500': sentiment.label === 'neutral',
                })}
              >
                {sentiment.label}
              </span>
              <span className="text-xs text-gray-500">score: {sentiment.score.toFixed(3)}</span>
            </div>
            <p className="text-sm text-gray-500 leading-snug">{sentiment.headline}</p>
            <p className="text-xs text-gray-500">{sentiment.source}</p>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No sentiment data</p>
        )}
      </div>

      {/* Predictions */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Predictions
        </h3>
        {predList.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {predList.map((p) => {
              const delta = p.predictedPrice - p.currentPrice;
              const pct = (delta / p.currentPrice) * 100;
              const positive = delta >= 0;
              return (
                <div key={p.horizon} className="bg-gray-100 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">{HORIZON_LABELS[p.horizon]}</div>
                  <div className="text-base font-semibold text-gray-900">
                    ${p.predictedPrice.toFixed(2)}
                  </div>
                  <div
                    className={clsx(
                      'text-xs font-medium',
                      positive ? 'text-green-600' : 'text-red-600',
                    )}
                  >
                    {positive ? '+' : ''}
                    {pct.toFixed(2)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    conf: {(p.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No predictions available</p>
        )}
      </div>
    </div>
  );
}

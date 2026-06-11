'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import type { OHLCVBar } from '@/types';

interface ChartPoint {
  time: string;
  price: number;
}

export function PriceChart({ symbol }: { symbol: string }): React.JSX.Element {
  const { data, isLoading } = useQuery<OHLCVBar[]>({
    queryKey: ['history', symbol],
    queryFn: () => api.get<OHLCVBar[]>(`/stocks/${symbol}/history?limit=100`).then((r) => r.data),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-64" />;
  }

  const points: ChartPoint[] = (data ?? [])
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((bar) => ({
      time: new Date(bar.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: bar.close,
    }));

  if (!points.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl h-64 flex items-center justify-center">
        <p className="text-gray-500 text-sm">No price history available</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Price History
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            width={55}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#9ca3af', fontSize: 11 }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

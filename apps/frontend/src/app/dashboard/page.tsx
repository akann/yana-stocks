'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { Portfolio } from '@/types';

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const { data: portfolios, isLoading: portfoliosLoading } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: () => api.get<Portfolio[]>('/portfolio/portfolios').then((r) => r.data),
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-32" />;
  }

  const totalValue = portfolios?.reduce((sum, p) => sum + (p.totalValue ?? 0), 0) ?? 0;
  const totalHoldings = portfolios?.reduce((sum, p) => sum + p.stocks.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-sm text-gray-400">Total Portfolio Value</p>
          <p className="text-2xl font-bold text-white mt-1">${totalValue.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-sm text-gray-400">Portfolios</p>
          <p className="text-2xl font-bold text-white mt-1">{portfolios?.length ?? 0}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-sm text-gray-400">Holdings</p>
          <p className="text-2xl font-bold text-white mt-1">{totalHoldings}</p>
        </div>
      </div>

      {portfoliosLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-800 rounded-xl h-24" />
          ))}
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="space-y-3">
          {portfolios.map((p) => (
            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-white">{p.name}</h3>
                {p.totalValue != null && (
                  <span className="text-sm text-gray-400">${p.totalValue.toFixed(2)}</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">{p.stocks.length} holdings</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">
          No portfolios yet.{' '}
          <a href="/portfolio" className="text-blue-400 hover:text-blue-300">
            Create one
          </a>
        </p>
      )}
    </div>
  );
}

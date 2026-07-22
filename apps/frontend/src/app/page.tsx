import React from 'react';
import type { Metadata } from 'next';
import { QueryClient, dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { HomePageView } from '@/components/home/HomePageView';
import { fetchPublicMarketData } from '@/lib/server-api';
import type { FactorTile, MarketMovers, MarketOverview, SectorRotationData } from '@/types';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://stocks.yanatech.co.uk/',
  },
  openGraph: {
    url: 'https://stocks.yanatech.co.uk/',
    title: 'YanaStocks by Akan Nkweini — Real-Time Stock Market Data & ML Predictions',
    description:
      'Live US stock prices, FinBERT sentiment analysis, ML-powered price predictions, and personal portfolio management by Akan Nkweini.',
  },
};

export default async function HomePage(): Promise<React.JSX.Element> {
  // A fresh QueryClient per request — never the shared client-side singleton,
  // which would leak cached data across requests/users on the server.
  const queryClient = new QueryClient();

  // Prefetch the homepage's above-the-fold public data server-side so it's
  // present in the initial HTML (real SSR) instead of appearing only after
  // the client fetches it post-hydration. `revalidate` gives each of these
  // ISR-style shared caching via Next's Data Cache. Query keys/endpoints must
  // match the corresponding useQuery calls exactly for hydration to work.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['market-overview'],
      queryFn: () => fetchPublicMarketData<MarketOverview>('/market/overview', 300),
    }),
    queryClient.prefetchQuery({
      queryKey: ['movers'],
      queryFn: () => fetchPublicMarketData<MarketMovers>('/market/movers', 10),
    }),
    queryClient.prefetchQuery({
      queryKey: ['factors'],
      queryFn: () => fetchPublicMarketData<FactorTile[]>('/market/factors', 900),
    }),
    queryClient.prefetchQuery({
      queryKey: ['sector-rotation', 'sp500'],
      queryFn: () =>
        fetchPublicMarketData<SectorRotationData>('/market/sectors/rotation?index=sp500', 3600),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomePageView />
    </HydrationBoundary>
  );
}

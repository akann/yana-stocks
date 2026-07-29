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
    // Next.js's per-segment openGraph object replaces (not merges with)
    // layout.tsx's, so siteName/type/locale must be repeated here — omitting
    // them caused og:site_name to silently disappear in production.
    siteName: 'YanaStocks',
    type: 'website',
    locale: 'en_GB',
    url: 'https://stocks.yanatech.co.uk/',
    title: 'YanaStocks — Real-Time Stock Data & ML Predictions',
    description:
      'Live US stock prices, FinBERT sentiment, ML-powered predictions, and portfolio management by Akan Nkweini.',
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
  //
  // Skipped entirely under E2E_TEST_MODE: this fetch runs server-side inside
  // this Server Component, before the page ever reaches the browser —
  // Playwright's page.route() only intercepts requests the browser makes, so
  // it can't mock this call. Every homepage e2e test that sets up route()
  // mocks would otherwise see real backend data instead of its fixtures.
  // Skipping it here falls back to each widget's own client-side useQuery,
  // which page.route() can intercept normally. Set by CI's "Start backend
  // services" step and playwright.config.ts's webServer.env for local runs.
  if (process.env.E2E_TEST_MODE !== 'true') {
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
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomePageView />
    </HydrationBoundary>
  );
}

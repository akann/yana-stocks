import React from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { Navbar } from '@/components/Navbar';
import { CookieBanner } from '@/components/CookieBanner';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Preconnect to Sentry's ingest origin (derived from the DSN, not hardcoded,
// so it tracks the region/project automatically — see proxy.ts's CSP
// connect-src for the same *.ingest.de.sentry.io region note).
const sentryOrigin = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
})();

// Every page must be dynamically rendered under the nonce-based CSP set in
// proxy.ts — a statically prerendered page's <script> tags are baked at
// build time, before proxy.ts ever runs, so they'd get no nonce and be
// silently blocked in production (works fine in `pnpm dev`, where every
// request is rendered fresh). See proxy.ts for the full explanation.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL('https://stocks.yanatech.co.uk'),
  title: {
    default: 'YanaStocks by Akan Nkweini — Real-Time Stock Market Data & ML Predictions',
    template: '%s | YanaStocks',
  },
  description:
    'YanaStocks by Akan Nkweini — live US stock prices, FinBERT sentiment analysis, ML-powered price predictions, and personal portfolio management. Track AAPL, GOOGL, MSFT, TSLA, NVDA and more.',
  keywords: [
    'YanaStocks',
    'Akan Nkweini',
    'stock market dashboard',
    'real-time stock prices',
    'portfolio management',
    'ML price predictions',
    'sentiment analysis',
    'FinBERT',
    'AAPL',
    'GOOGL',
    'MSFT',
    'TSLA',
    'NVDA',
  ],
  authors: [{ name: 'Akan Nkweini', url: 'https://yanatech.co.uk' }],
  creator: 'Akan Nkweini',
  openGraph: {
    type: 'website',
    siteName: 'YanaStocks',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {sentryOrigin && <link rel="preconnect" href={sentryOrigin} crossOrigin="anonymous" />}
        <Providers>
          <CookieBanner />
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

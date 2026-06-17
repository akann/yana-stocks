import React from 'react';
import type { Metadata } from 'next';
import { HomePageView } from '@/components/home/HomePageView';

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

export default function HomePage(): React.JSX.Element {
  return <HomePageView />;
}

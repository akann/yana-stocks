import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalystPanel } from '../AnalystPanel';

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const FULL_RATING = {
  strongBuy: 10,
  buy: 5,
  hold: 3,
  sell: 1,
  strongSell: 1,
  analystCount: 20,
  priceTarget: 650,
  consensus: 'strongBuy',
  asOf: new Date().toISOString(),
};

describe('AnalystPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the "Analyst Ratings" heading', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    expect(screen.getByText('Analyst Ratings')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the query is pending', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows "No analyst coverage" when analystCount is 0', async () => {
    mockApiGet.mockResolvedValue({
      data: { ...FULL_RATING, analystCount: 0 },
    });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    await waitFor(() => expect(screen.getByText('No analyst coverage')).toBeInTheDocument());
  });

  it('renders Buy and Sell aggregate counts from the data', async () => {
    mockApiGet.mockResolvedValue({ data: FULL_RATING });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    // strongBuy(10) + buy(5) = 15 Buy; sell(1) + strongSell(1) = 2 Sell
    await waitFor(() => expect(screen.getByText('15 Buy')).toBeInTheDocument());
    expect(screen.getByText('3 Hold')).toBeInTheDocument();
    expect(screen.getByText('2 Sell')).toBeInTheDocument();
  });

  it('renders the 5-column breakdown labels (Str Buy, Buy, Hold, Sell, Str Sell)', async () => {
    mockApiGet.mockResolvedValue({ data: FULL_RATING });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Str Buy')).toBeInTheDocument());
    expect(screen.getByText('Buy')).toBeInTheDocument();
    expect(screen.getByText('Hold')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    expect(screen.getByText('Str Sell')).toBeInTheDocument();
  });

  it('renders the price target when present', async () => {
    mockApiGet.mockResolvedValue({ data: FULL_RATING });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    await waitFor(() => expect(screen.getByText('$650.00')).toBeInTheDocument());
    expect(screen.getByText('Price target')).toBeInTheDocument();
  });

  it('shows positive upside % when price target > current price', async () => {
    // currentPrice=500, target=650 → upside = +30.0%
    mockApiGet.mockResolvedValue({ data: FULL_RATING });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    await waitFor(() => expect(screen.getByText('+30.0%')).toBeInTheDocument());
  });

  it('shows negative upside % when price target < current price', async () => {
    // currentPrice=700, target=650 → upside = -7.1%
    mockApiGet.mockResolvedValue({ data: FULL_RATING });
    render(<AnalystPanel symbol="NVDA" currentPrice={700} />, { wrapper });
    await waitFor(() => expect(screen.getByText('-7.1%')).toBeInTheDocument());
  });

  it('does not show price target section when priceTarget is null', async () => {
    mockApiGet.mockResolvedValue({ data: { ...FULL_RATING, priceTarget: null } });
    render(<AnalystPanel symbol="NVDA" currentPrice={500} />, { wrapper });
    await waitFor(() => expect(screen.getByText('15 Buy')).toBeInTheDocument());
    expect(screen.queryByText('Price target')).not.toBeInTheDocument();
  });
});

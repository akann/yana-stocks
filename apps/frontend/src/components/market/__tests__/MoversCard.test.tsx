import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoversCard } from '../MoversCard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

const mockMovers = {
  gainers: [
    { symbol: 'NVDA', price: 194.92, change: 10.5, changePercent: 5.7, volume: 1_200_000 },
    { symbol: 'AAPL', price: 180.0, change: 5.0, changePercent: 2.86, volume: 800_000 },
  ],
  losers: [{ symbol: 'TSLA', price: 150.0, change: -20.0, changePercent: -11.76, volume: 600_000 }],
};

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn() },
}));

const { api } = require('@/lib/api') as { api: { get: jest.Mock } };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('MoversCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading skeleton while the query is pending', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MoversCard />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders the Top Gainers and Top Losers section headings', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Top Gainers')).toBeInTheDocument();
      expect(screen.getByText('Top Losers')).toBeInTheDocument();
    });
  });

  it('renders gainer symbols and formatted prices', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('NVDA')).toBeInTheDocument();
      expect(screen.getByText('$194.92')).toBeInTheDocument();
      expect(screen.getByText('AAPL')).toBeInTheDocument();
    });
  });

  it('renders loser symbols', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('TSLA')).toBeInTheDocument();
    });
  });

  it('applies green text class to positive changePercent', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => screen.getByText('+5.70%'));
    const positive = screen.getByText('+5.70%');
    expect(positive).toHaveClass('text-green-800');
  });

  it('applies red text class to negative changePercent', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => screen.getByText('-11.76%'));
    const negative = screen.getByText('-11.76%');
    expect(negative).toHaveClass('text-red-700');
  });

  it('links each gainer row to /stocks/:symbol', async () => {
    api.get.mockResolvedValue({ data: mockMovers });
    render(<MoversCard />, { wrapper });
    await waitFor(() => screen.getByText('NVDA'));
    const link = screen.getByText('NVDA').closest('a');
    expect(link).toHaveAttribute('href', '/stocks/NVDA');
  });

  it('shows "No data" placeholder when gainers list is empty', async () => {
    api.get.mockResolvedValue({ data: { gainers: [], losers: [] } });
    render(<MoversCard />, { wrapper });
    await waitFor(() => {
      const noDataNodes = screen.getAllByText('No data');
      expect(noDataNodes).toHaveLength(2);
    });
  });
});

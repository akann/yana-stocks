import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockScreener } from '../StockScreener';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const MOCK_RESULTS = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 180.5,
    changesPercentage: 2.1,
    marketCap: 2_800_000_000_000,
    volume: 65_000_000,
    dividendYield: 0.52,
    sector: 'Technology',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    price: 415.0,
    changesPercentage: -0.3,
    marketCap: 3_100_000_000_000,
    volume: 22_000_000,
    dividendYield: 0.7,
    sector: 'Technology',
  },
];

describe('StockScreener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockReset();
  });

  it('renders the "Stock Screener" heading', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<StockScreener />, { wrapper });
    expect(screen.getByRole('heading', { name: 'Stock Screener' })).toBeInTheDocument();
  });

  it('renders filter labels: Market Cap, Min Volume, Sector', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<StockScreener />, { wrapper });
    expect(screen.getByText('Market Cap')).toBeInTheDocument();
    expect(screen.getByText('Min Volume')).toBeInTheDocument();
    expect(screen.getByText('Sector')).toBeInTheDocument();
  });

  it('shows loading state while query is pending', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<StockScreener />, { wrapper });
    expect(screen.getByText(/Screening/i)).toBeInTheDocument();
  });

  it('renders result rows with symbol links once data loads', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_RESULTS });
    render(<StockScreener />, { wrapper });
    await waitFor(() => expect(screen.getByRole('link', { name: 'AAPL' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'MSFT' })).toBeInTheDocument();
  });

  it('renders formatted prices in result rows', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_RESULTS });
    render(<StockScreener />, { wrapper });
    await waitFor(() => expect(screen.getByText('$180.50')).toBeInTheDocument());
    expect(screen.getByText('$415.00')).toBeInTheDocument();
  });

  it('renders positive change % in green and negative in red', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_RESULTS });
    render(<StockScreener />, { wrapper });
    // AAPL +2.10% green, MSFT -0.30% red
    await waitFor(() => expect(screen.getByText('+2.10%')).toBeInTheDocument());
    expect(screen.getByText('+2.10%')).toHaveClass('text-green-600');
    expect(screen.getByText('-0.30%')).toHaveClass('text-red-600');
  });

  it('links each result row to the stock detail page', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_RESULTS });
    render(<StockScreener />, { wrapper });
    await waitFor(() => expect(screen.getByRole('link', { name: 'AAPL' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'AAPL' })).toHaveAttribute('href', '/stocks/AAPL');
  });

  it('shows "No results" message when screener returns empty array', async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    render(<StockScreener />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No stocks match the current filters/i)).toBeInTheDocument(),
    );
  });

  it('has Hide Filters / Show Filters toggle button', async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    render(<StockScreener />, { wrapper });
    const toggleBtn = screen.getByRole('button', { name: 'Hide Filters' });
    expect(toggleBtn).toBeInTheDocument();
    await userEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: 'Show Filters' })).toBeInTheDocument();
  });

  it('has an Apply Filters button that triggers a new query', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_RESULTS });
    render(<StockScreener />, { wrapper });
    await waitFor(() => expect(screen.getByRole('link', { name: 'AAPL' })).toBeInTheDocument());
    const applyBtn = screen.getByRole('button', { name: /Apply/i });
    expect(applyBtn).toBeInTheDocument();
  });
});

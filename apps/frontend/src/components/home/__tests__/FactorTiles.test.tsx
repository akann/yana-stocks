import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FactorTiles } from '../FactorTiles';

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const MOCK_FACTORS = [
  { factor: 'Momentum', etf: 'MTUM', price: 200, change1d: 1.2, change1w: 3.4, change1m: 8.1 },
  { factor: 'Value', etf: 'VTV', price: 150, change1d: -0.5, change1w: 1.1, change1m: 2.3 },
  { factor: 'Growth', etf: 'VUG', price: 310, change1d: 2.1, change1w: 5.2, change1m: 12.0 },
  { factor: 'Dividend', etf: 'VIG', price: 180, change1d: 0.3, change1w: 0.8, change1m: 1.9 },
  { factor: 'Low Volatility', etf: 'USMV', price: 90, change1d: 0.1, change1w: 0.4, change1m: 0.9 },
  { factor: 'Quality', etf: 'QUAL', price: 140, change1d: 1.5, change1w: 3.0, change1m: 6.5 },
];

describe('FactorTiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the "Factor Performance" heading', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<FactorTiles />, { wrapper });
    expect(screen.getByText('Factor Performance')).toBeInTheDocument();
  });

  it('renders 1D / 1W / 1M timeframe toggle buttons', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<FactorTiles />, { wrapper });
    expect(screen.getByRole('button', { name: '1D' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument();
  });

  it('renders all 6 factor names once data loads', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    for (const { factor } of MOCK_FACTORS) {
      await waitFor(() => expect(screen.getByText(factor)).toBeInTheDocument());
    }
  });

  it('renders ETF ticker for each factor', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    await waitFor(() => expect(screen.getByText('Momentum')).toBeInTheDocument());
    // ETF tickers appear in the description text inside each tile
    expect(screen.getByText(/MTUM/)).toBeInTheDocument();
  });

  it('shows change1d values by default (1D view)', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    await waitFor(() => expect(screen.getByText('Momentum')).toBeInTheDocument());
    // Momentum change1d = +1.2% → "+1.20%"
    expect(screen.getByText('+1.20%')).toBeInTheDocument();
  });

  it('switches to change1w values when 1W is clicked', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    await waitFor(() => expect(screen.getByText('Momentum')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '1W' }));

    // Momentum change1w = +3.4% → "+3.40%"
    await waitFor(() => expect(screen.getByText('+3.40%')).toBeInTheDocument());
  });

  it('switches to change1m values when 1M is clicked', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    await waitFor(() => expect(screen.getByText('Momentum')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '1M' }));

    // Momentum change1m = +8.1% → "+8.10%"
    await waitFor(() => expect(screen.getByText('+8.10%')).toBeInTheDocument());
  });

  it('applies green formatting for positive change', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    await waitFor(() => expect(screen.getByText('+1.20%')).toBeInTheDocument());
    expect(screen.getByText('+1.20%')).toHaveClass('text-green-700');
  });

  it('applies red formatting for negative change', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_FACTORS });
    render(<FactorTiles />, { wrapper });
    // Value change1d = -0.5% → "-0.50%"
    await waitFor(() => expect(screen.getByText('-0.50%')).toBeInTheDocument());
    expect(screen.getByText('-0.50%')).toHaveClass('text-red-600');
  });
});

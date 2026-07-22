import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IndicesBar } from '../IndicesBar';

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const MOCK_OVERVIEW = {
  indices: [
    { symbol: '^GSPC', name: 'S&P 500', price: 5200.5, change: 25.3, changesPercentage: 0.49 },
    { symbol: '^IXIC', name: 'Nasdaq', price: 16400.0, change: -80.2, changesPercentage: -0.49 },
    { symbol: '^FTSE', name: 'FTSE 100', price: 8150.0, change: 12.5, changesPercentage: 0.15 },
    { symbol: '^GDAXI', name: 'DAX', price: 18500.0, change: -50.0, changesPercentage: -0.27 },
  ],
  sectors: [],
  news: [],
};

describe('IndicesBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading skeletons while the query is pending', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(<IndicesBar />, { wrapper });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('renders all four index names once data loads', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_OVERVIEW });
    render(<IndicesBar />, { wrapper });
    await waitFor(() => expect(screen.getByText('S&P 500')).toBeInTheDocument());
    expect(screen.getByText('Nasdaq')).toBeInTheDocument();
    expect(screen.getByText('FTSE 100')).toBeInTheDocument();
    expect(screen.getByText('DAX')).toBeInTheDocument();
  });

  it('renders formatted prices', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_OVERVIEW });
    render(<IndicesBar />, { wrapper });
    await waitFor(() => expect(screen.getByText('5,200.50')).toBeInTheDocument());
  });

  it('applies green text class for a positive change', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_OVERVIEW });
    render(<IndicesBar />, { wrapper });
    await waitFor(() => expect(screen.getByText('S&P 500')).toBeInTheDocument());
    // S&P 500 has changesPercentage = +0.49 → green
    const sp500Card = screen.getByText('S&P 500').closest('div')!;
    const changeEl = sp500Card.parentElement?.querySelector('.text-green-700');
    expect(changeEl).toBeInTheDocument();
  });

  it('applies red text class for a negative change', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_OVERVIEW });
    render(<IndicesBar />, { wrapper });
    await waitFor(() => expect(screen.getByText('Nasdaq')).toBeInTheDocument());
    const nasdaqCard = screen.getByText('Nasdaq').closest('div')!;
    const changeEl = nasdaqCard.parentElement?.querySelector('.text-red-600');
    expect(changeEl).toBeInTheDocument();
  });

  it('renders one card per index', async () => {
    mockApiGet.mockResolvedValue({ data: MOCK_OVERVIEW });
    const { container } = render(<IndicesBar />, { wrapper });
    await waitFor(() => expect(screen.getByText('S&P 500')).toBeInTheDocument());
    // Each index is a direct child div of the grid
    const grid = container.firstChild as HTMLElement;
    expect(grid.children).toHaveLength(4);
  });
});

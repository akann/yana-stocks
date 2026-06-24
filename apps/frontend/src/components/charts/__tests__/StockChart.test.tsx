import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockChart } from '../StockChart';

// Prevent real API calls
// (lightweight-charts is mocked via moduleNameMapper → src/__mocks__/lightweight-charts.js)
jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(() => new Promise(() => {})) }, // stays pending (simulates loading)
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('StockChart', () => {
  it('renders without crashing', () => {
    render(<StockChart symbol="AAPL" />, { wrapper });
  });

  it('shows all 7 range buttons', () => {
    render(<StockChart symbol="AAPL" />, { wrapper });
    for (const label of ['1H', '1D', '1W', '1M', '3M', '6M', '1Y']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('shows Candle and Line chart-type buttons', () => {
    render(<StockChart symbol="AAPL" />, { wrapper });
    expect(screen.getByRole('button', { name: 'Candle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Line' })).toBeInTheDocument();
  });

  it('shows all 5 MA toggle buttons', () => {
    render(<StockChart symbol="AAPL" />, { wrapper });
    for (const label of ['SMA 20', 'SMA 50', 'SMA 200', 'EMA 12', 'EMA 26']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('MA buttons are inactive (no background color) on initial render', () => {
    render(<StockChart symbol="AAPL" />, { wrapper });
    const sma20 = screen.getByRole('button', { name: 'SMA 20' });
    expect(sma20).not.toHaveStyle({ backgroundColor: '#3b82f6' });
  });

  it('activates an MA button when clicked', async () => {
    const user = userEvent.setup();
    render(<StockChart symbol="AAPL" />, { wrapper });
    const sma20 = screen.getByRole('button', { name: 'SMA 20' });
    await user.click(sma20);
    expect(sma20).toHaveStyle({ backgroundColor: '#3b82f6' });
  });

  it('deactivates an MA button when clicked twice', async () => {
    const user = userEvent.setup();
    render(<StockChart symbol="AAPL" />, { wrapper });
    const sma20 = screen.getByRole('button', { name: 'SMA 20' });
    await user.click(sma20);
    await user.click(sma20);
    expect(sma20).not.toHaveStyle({ backgroundColor: '#3b82f6' });
  });

  it('shows a loading skeleton while data is pending', () => {
    const { container } = render(<StockChart symbol="AAPL" />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});

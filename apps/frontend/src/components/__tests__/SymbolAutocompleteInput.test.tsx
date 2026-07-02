import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SymbolAutocompleteInput } from '../SymbolAutocompleteInput';

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

const ASSETS = {
  data: [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'AAPU', name: 'Direxion Daily AAPL Bull 2X' },
  ],
  total: 2,
  page: 1,
  limit: 8,
};

function Harness({ onSubmit }: { onSubmit?: (symbol: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
    >
      <SymbolAutocompleteInput
        value={value}
        onChange={(v) => setValue(v.toUpperCase())}
        placeholder="Symbol"
      />
    </form>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SymbolAutocompleteInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: ASSETS });
  });

  it('shows suggestions from /market/assets after typing', async () => {
    renderWithClient(<Harness />);

    await userEvent.type(screen.getByPlaceholderText('Symbol'), 'AAP');

    await waitFor(() => {
      expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    });
    expect(mockApiGet).toHaveBeenCalledWith('/market/assets', {
      params: { search: 'AAP', limit: 8, market: 'all' },
    });
  });

  it('fills the input when a suggestion is clicked', async () => {
    renderWithClient(<Harness />);
    const input = screen.getByPlaceholderText('Symbol');

    await userEvent.type(input, 'AAP');
    await waitFor(() => expect(screen.getByText('Apple Inc.')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Apple Inc.'));

    expect(input).toHaveValue('AAPL');
    expect(screen.queryByText('Apple Inc.')).not.toBeInTheDocument();
  });

  it('selects the highlighted suggestion with arrow keys + Enter without submitting the form', async () => {
    const onSubmit = jest.fn();
    renderWithClient(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText('Symbol');

    await userEvent.type(input, 'AAP');
    await waitFor(() => expect(screen.getByText('Apple Inc.')).toBeInTheDocument());

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(input).toHaveValue('AAPU');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lets Enter submit the surrounding form when no suggestion is highlighted', async () => {
    const onSubmit = jest.fn();
    renderWithClient(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText('Symbol');

    await userEvent.type(input, 'AAP');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('AAP');
  });
});

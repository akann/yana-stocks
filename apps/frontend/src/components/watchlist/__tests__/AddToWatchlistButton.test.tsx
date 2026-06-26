import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddToWatchlistButton } from '../AddToWatchlistButton';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

const WL_A = {
  id: 'wl-1',
  name: 'Tech Stocks',
  symbols: [],
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
};
const WL_B = {
  id: 'wl-2',
  name: 'Value Plays',
  symbols: [],
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
};
const WL_C = {
  id: 'wl-3',
  name: 'Dividend',
  symbols: [],
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AddToWatchlistButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockReset();
  });

  it('renders a + button with correct aria-label', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    expect(screen.getByRole('button', { name: 'Add AAPL to watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add AAPL to watchlist' })).toHaveTextContent('+');
  });

  it('redirects to /login when not authenticated', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('redirects to /watchlist when authenticated with 0 eligible watchlists', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [] });
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    expect(mockPush).toHaveBeenCalledWith('/watchlist');
  });

  it('immediately adds to the sole eligible watchlist without showing a dropdown', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [WL_A] });
    mockApiPost.mockResolvedValue({ data: {} });
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    expect(mockApiPost).toHaveBeenCalledWith('/portfolio/watchlists/wl-1/symbols', {
      symbol: 'AAPL',
    });
    expect(screen.queryByText('Tech Stocks')).not.toBeInTheDocument();
  });

  it('opens a dropdown listing all watchlists when there are multiple', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [WL_A, WL_B] });
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    expect(screen.getByText('Tech Stocks')).toBeInTheDocument();
    expect(screen.getByText('Value Plays')).toBeInTheDocument();
  });

  it('fires mutation with correct watchlist id when dropdown item clicked', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [WL_A, WL_B] });
    mockApiPost.mockResolvedValue({ data: {} });
    render(<AddToWatchlistButton symbol="AAPL" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    await user.click(screen.getByText('Value Plays'));
    expect(mockApiPost).toHaveBeenCalledWith('/portfolio/watchlists/wl-2/symbols', {
      symbol: 'AAPL',
    });
  });

  it('excludeWatchlistId adds directly to the only remaining watchlist', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [WL_A, WL_B] });
    mockApiPost.mockResolvedValue({ data: {} });
    render(<AddToWatchlistButton symbol="AAPL" excludeWatchlistId="wl-1" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    // wl-1 excluded → only wl-2 eligible → immediate add, no dropdown
    expect(mockApiPost).toHaveBeenCalledWith('/portfolio/watchlists/wl-2/symbols', {
      symbol: 'AAPL',
    });
    expect(screen.queryByText('Value Plays')).not.toBeInTheDocument();
  });

  it('excludeWatchlistId removes one entry from the dropdown when there are 3 watchlists', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockApiGet.mockResolvedValue({ data: [WL_A, WL_B, WL_C] });
    render(<AddToWatchlistButton symbol="AAPL" excludeWatchlistId="wl-1" />, { wrapper });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add AAPL to watchlist' }));
    expect(screen.queryByText('Tech Stocks')).not.toBeInTheDocument();
    expect(screen.getByText('Value Plays')).toBeInTheDocument();
    expect(screen.getByText('Dividend')).toBeInTheDocument();
  });
});

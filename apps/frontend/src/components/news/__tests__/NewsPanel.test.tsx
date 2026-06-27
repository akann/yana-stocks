import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewsPanel } from '../NewsPanel';

const mockApiGet = jest.fn();
jest.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ARTICLES = [
  {
    headline: 'NVIDIA Reports Record Revenue',
    source: 'Reuters',
    url: 'https://example.com/1',
    publishedAt: '2026-01-01T08:00:00.000Z',
    sentimentLabel: 'positive',
    sentimentScore: 0.92,
  },
  {
    headline: 'AI Chip Demand Surges',
    source: 'Bloomberg',
    url: 'https://example.com/2',
    publishedAt: '2026-01-01T07:00:00.000Z',
    sentimentLabel: 'neutral',
    sentimentScore: 0.5,
  },
  {
    headline: 'Supply Chain Concerns',
    source: 'FT',
    url: 'https://example.com/3',
    publishedAt: '2026-01-01T06:00:00.000Z',
    sentimentLabel: 'negative',
    sentimentScore: 0.71,
  },
];

describe('NewsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the "Recent News" heading', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    expect(screen.getByText('Recent News')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the query is pending', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(<NewsPanel symbol="NVDA" />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows "No news available" when articles array is empty', async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    await waitFor(() => expect(screen.getByText('No news available')).toBeInTheDocument());
  });

  it('renders article headlines', async () => {
    mockApiGet.mockResolvedValue({ data: ARTICLES });
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText('NVIDIA Reports Record Revenue')).toBeInTheDocument(),
    );
    expect(screen.getByText('AI Chip Demand Surges')).toBeInTheDocument();
    expect(screen.getByText('Supply Chain Concerns')).toBeInTheDocument();
  });

  it('renders source names for each article', async () => {
    mockApiGet.mockResolvedValue({ data: ARTICLES });
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    await waitFor(() => expect(screen.getByText('Reuters')).toBeInTheDocument());
    expect(screen.getByText('Bloomberg')).toBeInTheDocument();
    expect(screen.getByText('FT')).toBeInTheDocument();
  });

  it('renders sentiment labels: positive, neutral, negative', async () => {
    mockApiGet.mockResolvedValue({ data: ARTICLES });
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    await waitFor(() => expect(screen.getByText('positive')).toBeInTheDocument());
    expect(screen.getByText('neutral')).toBeInTheDocument();
    expect(screen.getByText('negative')).toBeInTheDocument();
  });

  it('renders headlines as links with target="_blank"', async () => {
    mockApiGet.mockResolvedValue({ data: [ARTICLES[0]] });
    render(<NewsPanel symbol="NVDA" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText('NVIDIA Reports Record Revenue')).toBeInTheDocument(),
    );
    const link = screen.getByText('NVIDIA Reports Record Revenue').closest('a');
    expect(link).toHaveAttribute('href', 'https://example.com/1');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

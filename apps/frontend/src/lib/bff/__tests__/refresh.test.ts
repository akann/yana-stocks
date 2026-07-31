/** @jest-environment node */
import { refreshOnce } from '../refresh';

describe('bff/refresh', () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.AUTH_SERVICE_URL = 'http://auth.test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_SERVICE_URL;
    jest.clearAllMocks();
  });

  // Each case uses its own unique token string — refreshOnce caches a
  // successful result per-token-hash for a short window (see refresh.ts),
  // so reusing one token across cases would leak results between tests.

  it('returns the new token pair on a successful refresh', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2' }), { status: 200 }),
    );

    const result = await refreshOnce('RT-SUCCESS');

    expect(result).toEqual({ accessToken: 'AT2', refreshToken: 'RT2' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://auth.test/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'RT-SUCCESS' }),
      }),
    );
  });

  it('returns null when the upstream call fails', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 401 }));
    const result = await refreshOnce('RT-401');
    expect(result).toBeNull();
  });

  it('returns null (not throw) on a network error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    await expect(refreshOnce('RT-NETWORK-ERROR')).resolves.toBeNull();
  });

  it('dedupes concurrent refreshes for the same token — only one upstream call', async () => {
    let resolveUpstream!: (res: Response) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveUpstream = resolve;
      }),
    );

    const first = refreshOnce('RT-SAME');
    const second = refreshOnce('RT-SAME');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveUpstream(
      new Response(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT' }), { status: 200 }),
    );

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
    expect(r2).toBe(r1);
  });

  it('does not dedupe refreshes for different tokens', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT' }), { status: 200 }),
    );
    await Promise.all([refreshOnce('RT-A'), refreshOnce('RT-B')]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a request arriving with an already-rotated token still resolves against the same result', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT' }), { status: 200 }),
    );

    const first = await refreshOnce('RT-OLD');
    // Simulates a second concurrent request that read the cookie before the
    // first request's Set-Cookie updated it — it still holds the old token.
    const second = await refreshOnce('RT-OLD');

    expect(mockFetch).toHaveBeenCalledTimes(1); // second call served from the recently-rotated cache
    expect(second).toEqual(first);
  });
});

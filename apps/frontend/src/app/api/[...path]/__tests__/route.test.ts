/** @jest-environment node */
import { NextRequest } from 'next/server';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/bff/refresh', () => ({ refreshOnce: jest.fn() }));

import { cookies } from 'next/headers';
import { refreshOnce } from '@/lib/bff/refresh';
import { GET, POST } from '../route';

const mockCookies = cookies as unknown as jest.Mock;
const mockRefreshOnce = refreshOnce as jest.Mock;

function cookieStore(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

function req(
  method: string,
  url: string,
  init: { body?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(url, { method, headers: init.headers, body: init.body });
}

function call(method: 'GET' | 'POST', request: NextRequest, path: string[]) {
  const handler = method === 'GET' ? GET : POST;
  return handler(request, { params: Promise.resolve({ path }) });
}

describe('[...path] catch-all proxy', () => {
  let mockFetch: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.API_GATEWAY_URL = 'https://api-gateway.test';
    mockCookies.mockResolvedValue(cookieStore({}));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.API_GATEWAY_URL;
    jest.clearAllMocks();
  });

  it('forwards to the resolved upstream with the path and query string preserved', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await call('GET', req('GET', 'http://localhost:3000/api/market/assets?search=aa&page=2'), [
      'market',
      'assets',
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-gateway.test/api/market/assets?search=aa&page=2',
      expect.anything(),
    );
  });

  it('attaches Authorization from the access_token cookie', async () => {
    mockCookies.mockResolvedValue(cookieStore({ access_token: 'AT123' }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await call('GET', req('GET', 'http://localhost:3000/api/stocks/AAPL'), ['stocks', 'AAPL']);

    const sentHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.get('authorization')).toBe('Bearer AT123');
  });

  // Regression: Kong trusts X-Forwarded-Host for its own route matching (it
  // sits behind ingress-nginx). Forwarding the inbound request's own
  // X-Forwarded-Host (this origin, stocks.yanatech.co.uk) onto the outbound
  // call to Kong made Kong route on the wrong host — which has no Kong route
  // at all — breaking every proxied call with a 404 "no Route matched" in
  // production (2026-08-01).
  it('does not forward X-Forwarded-Host/-Port from the inbound request to the upstream fetch', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await call(
      'GET',
      req('GET', 'http://localhost:3000/api/market/movers', {
        headers: { 'x-forwarded-host': 'stocks.yanatech.co.uk', 'x-forwarded-port': '443' },
      }),
      ['market', 'movers'],
    );

    const sentHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.get('x-forwarded-host')).toBeNull();
    expect(sentHeaders.get('x-forwarded-port')).toBeNull();
  });

  it('sends no Authorization header when there is no access_token cookie', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await call('GET', req('GET', 'http://localhost:3000/api/market/overview'), [
      'market',
      'overview',
    ]);
    const sentHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.has('authorization')).toBe(false);
  });

  it('strips the cookie header before forwarding upstream', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await call(
      'GET',
      req('GET', 'http://localhost:3000/api/market/overview', {
        headers: { cookie: 'access_token=AT123; refresh_token=RT123' },
      }),
      ['market', 'overview'],
    );
    const sentHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.has('cookie')).toBe(false);
  });

  it('rejects a cross-origin mutating request', async () => {
    const res = await call(
      'POST',
      req('POST', 'http://localhost:3000/api/portfolio/portfolios', {
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
      ['portfolio', 'portfolios'],
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows a same-origin mutating request', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await call(
      'POST',
      req('POST', 'http://localhost:3000/api/portfolio/portfolios', {
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: '{}',
      }),
      ['portfolio', 'portfolios'],
    );
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('allows a mutating request with no Origin header at all', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await call(
      'POST',
      req('POST', 'http://localhost:3000/api/portfolio/portfolios', { body: '{}' }),
      ['portfolio', 'portfolios'],
    );
    expect(res.status).toBe(200);
  });

  it('on a 401, refreshes once and retries with the new access token', async () => {
    mockCookies.mockResolvedValue(cookieStore({ access_token: 'EXPIRED', refresh_token: 'RT1' }));
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: 'ok' }), { status: 200 }));
    mockRefreshOnce.mockResolvedValue({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT' });

    const res = await call('GET', req('GET', 'http://localhost:3000/api/stocks/AAPL'), [
      'stocks',
      'AAPL',
    ]);

    expect(mockRefreshOnce).toHaveBeenCalledWith('RT1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const retryHeaders = mockFetch.mock.calls[1]?.[1]?.headers as Headers;
    expect(retryHeaders.get('authorization')).toBe('Bearer NEW_AT');
    expect(res.status).toBe(200);
    expect(res.cookies.get('access_token')?.value).toBe('NEW_AT');
  });

  it('returns 401 and clears cookies when the refresh itself fails', async () => {
    mockCookies.mockResolvedValue(cookieStore({ access_token: 'EXPIRED', refresh_token: 'RT1' }));
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    mockRefreshOnce.mockResolvedValue(null);

    const res = await call('GET', req('GET', 'http://localhost:3000/api/stocks/AAPL'), [
      'stocks',
      'AAPL',
    ]);

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.cookies.get('access_token')?.maxAge).toBe(0);
  });

  it('returns the 401 unchanged when there is no refresh_token cookie at all', async () => {
    mockCookies.mockResolvedValue(cookieStore({ access_token: 'EXPIRED' }));
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const res = await call('GET', req('GET', 'http://localhost:3000/api/stocks/AAPL'), [
      'stocks',
      'AAPL',
    ]);

    expect(res.status).toBe(401);
    expect(mockRefreshOnce).not.toHaveBeenCalled();
  });

  it('does not retry a second time if the retried request also 401s', async () => {
    mockCookies.mockResolvedValue(cookieStore({ access_token: 'EXPIRED', refresh_token: 'RT1' }));
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    mockRefreshOnce.mockResolvedValue({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT' });

    const res = await call('GET', req('GET', 'http://localhost:3000/api/stocks/AAPL'), [
      'stocks',
      'AAPL',
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(401);
  });
});

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveUpstream } from '@/lib/bff/upstream';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '@/lib/bff/cookies';
import { refreshOnce } from '@/lib/bff/refresh';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAFE_METHODS = new Set(['GET', 'HEAD']);
// Hop-by-hop or leg-specific — must not be copied onto the server-to-server fetch.
// x-forwarded-host/-port describe THIS origin (stocks.yanatech.co.uk) as seen by
// ingress-nginx on the inbound request — forwarding them onto the outbound call
// to Kong (API_GATEWAY_URL) is wrong, since that's a brand-new request to a
// different origin, not a continuation of the inbound one. Kong trusts
// X-Forwarded-Host for its own route matching (it sits behind another proxy),
// so leaking the original Host here made Kong route on "stocks.yanatech.co.uk"
// — which has no Kong route at all, only an nginx ingress straight to this
// frontend — instead of api-gateway.yanatech.co.uk, breaking every proxied
// call with "no Route matched" 404s. x-forwarded-for/-proto are kept: Kong's
// IP-scoped rate-limiting plugin needs the real client IP, not this pod's.
const STRIP_REQUEST_HEADERS = new Set([
  'cookie',
  'host',
  'connection',
  'content-length',
  'x-forwarded-host',
  'x-forwarded-port',
]);
// Already-decoded (undici) or leg-specific — must not be copied onto our own response.
const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

function buildResponse(upstreamRes: Response): NextResponse {
  const headers = new Headers();
  for (const [key, value] of upstreamRes.headers) {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  }
  return new NextResponse(upstreamRes.body, { status: upstreamRes.status, headers });
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  // CSRF: httpOnly cookies auto-attach, unlike the bearer token they replace
  // — reject a mutating cross-origin request outright. SameSite=Lax
  // (cookies.ts) is the primary defense; this is deliberate defense-in-depth
  // given zero CSRF protection existed anywhere in the stack before this.
  if (!SAFE_METHODS.has(req.method)) {
    const origin = req.headers.get('origin');
    if (origin && origin !== req.nextUrl.origin) {
      return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
    }
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const target = `${resolveUpstream(path)}/api/${path.join('/')}${req.nextUrl.search}`;
  const body = SAFE_METHODS.has(req.method) ? undefined : await req.arrayBuffer();

  const attempt = (token: string | undefined): Promise<Response> => {
    const headers = new Headers();
    for (const [key, value] of req.headers) {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  };

  const firstRes = await attempt(accessToken);
  if (firstRes.status !== 401) return buildResponse(firstRes);

  // Access token missing/expired — try a server-side refresh once, invisible
  // to the client, then retry the original request exactly once.
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  const tokens = refreshToken ? await refreshOnce(refreshToken) : null;
  if (!tokens) {
    const res = buildResponse(firstRes);
    clearAuthCookies(res);
    return res;
  }

  const retryRes = await attempt(tokens.accessToken);
  const res = buildResponse(retryRes);
  setAuthCookies(res, tokens);
  return res;
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

import { NextRequest, NextResponse } from 'next/server';

// Presence-check only — no JWT verification, no JWT_SECRET distributed to
// the frontend. This is a UX optimization (no flash of protected content, no
// client useEffect round-trip) — real authorization enforcement is
// unchanged: Kong verifies the JWT signature and each backend service's own
// guard checks claims. An expired-but-present cookie still reaches the page;
// its API calls then 401 → the BFF (/api/[...path]) refreshes transparently
// → recovery or a client-side redirect. Closes a real gap: /stocks/[symbol]
// previously had no auth guard at all (relied solely on that API 401).
const PROTECTED_ROUTES = [
  /^\/dashboard/,
  /^\/portfolio/,
  /^\/watchlist/,
  /^\/stocks\//,
  /^\/profile/,
];

// script-src needs a per-request nonce (not achievable from next.config.mjs's
// static headers()) because Next's App Router streams the RSC hydration
// payload via inline <script> tags on every page — without a nonce (or
// 'unsafe-inline', which we don't want), the browser blocks them and React
// never hydrates anywhere in the app. Next automatically applies this nonce
// to its own inline scripts once it sees one in the CSP response header.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PROTECTED_ROUTES.some((r) => r.test(pathname)) && !request.cookies.get('access_token')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Next's dev server (Fast Refresh, source-mapped error overlay) needs
  // eval() — never used in a production build, so this only loosens dev.
  const scriptSrc =
    process.env.NODE_ENV === 'development'
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // Avatar URLs are arbitrary user-supplied external images
    // (profile-service's `avatar` field has no host allowlist) — img-src
    // needs to allow any https host, not just 'self'.
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // The browser now only ever calls this app's own origin — the BFF
    // (src/app/api/[...path]/route.ts) is what talks to the real backend,
    // server-to-server, so 'self' alone covers every environment (dev, prod,
    // CI's e2e job) uniformly. No more NEXT_PUBLIC_API_URL-derived origin
    // needed here (that coupling previously caused a real CI regression).
    // Sentry's ingest host is region-specific — this project's DSN
    // (NEXT_PUBLIC_SENTRY_DSN) is on the EU region, *.ingest.de.sentry.io.
    "connect-src 'self' https://*.ingest.de.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

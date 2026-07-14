import { NextRequest, NextResponse } from 'next/server';

// script-src needs a per-request nonce (not achievable from next.config.mjs's
// static headers()) because Next's App Router streams the RSC hydration
// payload via inline <script> tags on every page — without a nonce (or
// 'unsafe-inline', which we don't want), the browser blocks them and React
// never hydrates anywhere in the app. Next automatically applies this nonce
// to its own inline scripts once it sees one in the CSP response header.
export function proxy(request: NextRequest) {
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
    // api-gateway is a separate origin the browser calls directly in
    // production (NEXT_PUBLIC_API_URL); in dev it's same-origin via
    // next.config.mjs rewrites, so 'self' alone would work there. Sentry's
    // ingest host is region-specific — this project's DSN
    // (NEXT_PUBLIC_SENTRY_DSN) is on the EU region, *.ingest.de.sentry.io.
    "connect-src 'self' https://api-gateway.yanatech.co.uk https://*.ingest.de.sentry.io",
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

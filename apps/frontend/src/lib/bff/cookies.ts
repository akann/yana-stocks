import type { NextResponse } from 'next/server';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const MFA_TOKEN_COOKIE = 'mfa_token';

const ACCESS_TOKEN_MAX_AGE = 900; // 15min — matches auth-service's JWT_EXPIRES_IN default
const REFRESH_TOKEN_MAX_AGE = 604_800; // 7d — matches auth-service's JWT_REFRESH_EXPIRES_IN default
const MFA_TOKEN_MAX_AGE = 300; // 5min — matches auth-service's mfa_challenge Redis TTL

// Read lazily (not cached at module load) so it reflects the actual runtime
// env at call time, not whatever it was when this module first loaded.
function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Host-only cookies (no Domain attribute) — scoped to this origin
 * (stocks.yanatech.co.uk) only, never shared with other *.yanatech.co.uk
 * subdomains. refresh_token is Path-scoped to /api (not /api/auth) because
 * the catch-all proxy's own refresh-retry at e.g. /api/stocks/... needs it
 * too, not just the dedicated auth routes.
 */
export function setAuthCookies(res: NextResponse, tokens: TokenPair): void {
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  res.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/api',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

export function setMfaTokenCookie(res: NextResponse, mfaToken: string): void {
  res.cookies.set(MFA_TOKEN_COOKIE, mfaToken, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: MFA_TOKEN_MAX_AGE,
  });
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_TOKEN_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_TOKEN_COOKIE, '', { path: '/api', maxAge: 0 });
}

export function clearMfaTokenCookie(res: NextResponse): void {
  res.cookies.set(MFA_TOKEN_COOKIE, '', { path: '/api/auth', maxAge: 0 });
}

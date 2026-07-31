import { createHash } from 'node:crypto';
import { resolveUpstream } from './upstream';
import type { TokenPair } from './cookies';

const RECENTLY_ROTATED_TTL_MS = 10_000;

interface RotatedEntry {
  tokens: TokenPair | null;
  expiresAt: number;
}

// Per-replica, in-process. The refresh token is single-use and rotated
// server-side, so without this a page firing several concurrent requests
// that all 401 at once would send several refresh attempts with the SAME
// token — the first rotates it, the rest hard-fail and log a valid user out.
const inflight = new Map<string, Promise<TokenPair | null>>();
// Covers the request that arrives holding an already-consumed token (e.g. it
// read the refresh_token cookie before an earlier request's Set-Cookie
// updated it) — such a request should still resolve against the same result
// instead of being treated as a stale/invalid token.
const recentlyRotated = new Map<string, RotatedEntry>();

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function doRefresh(refreshToken: string): Promise<TokenPair | null> {
  try {
    const res = await fetch(`${resolveUpstream(['auth'])}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenPair;
  } catch {
    return null;
  }
}

/** Refreshes `refreshToken`, deduping concurrent calls for the same token. */
export async function refreshOnce(refreshToken: string): Promise<TokenPair | null> {
  const key = hash(refreshToken);

  const recent = recentlyRotated.get(key);
  if (recent && recent.expiresAt > Date.now()) return recent.tokens;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = doRefresh(refreshToken).then((tokens) => {
    recentlyRotated.set(key, { tokens, expiresAt: Date.now() + RECENTLY_ROTATED_TTL_MS });
    return tokens;
  });
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

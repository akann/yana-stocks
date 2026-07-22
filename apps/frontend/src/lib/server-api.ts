// Server-only fetch helper — do not import from a 'use client' component.
// Used to prefetch public market data inside Server Components so it ships
// in the initial HTML (real SSR) instead of being fetched from the browser
// after hydration. Uses Next's fetch Data Cache with `revalidate` for
// ISR-style caching shared across requests.

const PORTFOLIO_API_URL = process.env.PORTFOLIO_API_URL ?? 'http://localhost:3006';

function resolveApiOrigin(): string {
  const publicUrl = process.env.NEXT_PUBLIC_API_URL;
  if (publicUrl && /^https?:\/\//.test(publicUrl)) {
    return publicUrl.replace(/\/$/, '');
  }
  // Dev fallback: NEXT_PUBLIC_API_URL is unset (browser uses the relative
  // '/api' proxy path via next.config.mjs rewrites, which only applies to
  // incoming HTTP requests, not outgoing server-side fetches). Hit
  // portfolio-api directly instead, mirroring next.config.mjs's rewrites().
  return `${PORTFOLIO_API_URL}/api`;
}

export async function fetchPublicMarketData<T>(
  path: string,
  revalidateSeconds: number,
): Promise<T | null> {
  try {
    const res = await fetch(`${resolveApiOrigin()}${path}`, {
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Prefetch is a progressive enhancement — on failure the client-side
    // useQuery in each widget still fetches normally after hydration.
    return null;
  }
}

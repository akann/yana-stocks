// Server-only fetch helper — do not import from a 'use client' component.
// Used to prefetch public market data inside Server Components so it ships
// in the initial HTML (real SSR) instead of being fetched from the browser
// after hydration. Uses Next's fetch Data Cache with `revalidate` for
// ISR-style caching shared across requests.

import { resolveUpstream } from './bff/upstream';

export async function fetchPublicMarketData<T>(
  path: string,
  revalidateSeconds: number,
): Promise<T | null> {
  try {
    const res = await fetch(`${resolveUpstream(['market'])}/api${path}`, {
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

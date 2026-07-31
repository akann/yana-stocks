/**
 * Resolves which backend origin a proxied /api/<prefix>/... request should
 * be forwarded to, server-to-server. In prod this is Kong (API_GATEWAY_URL —
 * a server-only env var; the browser never sees or calls it directly
 * anymore). In dev (no Kong running locally) it falls back to the same
 * per-prefix service map next.config.mjs's rewrites() used to encode.
 */
// Read lazily (not cached at module load) so it reflects the actual runtime
// env at call time, not whatever it was when this module first loaded.
export function resolveUpstream(path: string[]): string {
  const gateway = process.env.API_GATEWAY_URL;
  if (gateway) return gateway;

  const devServiceUrls: Record<string, string> = {
    auth: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3004',
    profile: process.env.PROFILE_SERVICE_URL ?? 'http://localhost:3007',
  };
  const devDefaultUrl = process.env.PORTFOLIO_API_URL ?? 'http://localhost:3006';

  const prefix = path[0] ?? '';
  return devServiceUrls[prefix] ?? devDefaultUrl;
}

import { withSentryConfig } from '@sentry/nextjs';
import withBundleAnalyzerInit from '@next/bundle-analyzer';

const withBundleAnalyzer = withBundleAnalyzerInit({ enabled: process.env.ANALYZE === 'true' });

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  // technicalindicators ESM entry (lib/index.js) has bare imports without .js extensions
  // which break under strict ESM. Force webpack to bundle it via transpilePackages.
  transpilePackages: ['technicalindicators'],
  serverExternalPackages: [
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-trace-otlp-http',
  ],
  // No rewrites() anymore — src/app/api/[...path]/route.ts replaces it in
  // both dev and prod with one code path (a rewrite can't inject the
  // Authorization header from the httpOnly access_token cookie, which is the
  // whole point of that BFF route). See src/lib/bff/upstream.ts for the
  // dev-vs-prod backend resolution this used to encode here.
  async headers() {
    // Content-Security-Policy is set in proxy.ts, not here — script-src
    // needs a per-request nonce, which a static headers() config can't
    // generate. See proxy.ts for the full explanation.
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withBundleAnalyzer(config), {
  org: 'yanatech-tech-limited',
  project: 'yana-stocks-frontend',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});

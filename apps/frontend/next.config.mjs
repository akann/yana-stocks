import { withSentryConfig } from '@sentry/nextjs';

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
  // In production Kong handles /api/* routing. In dev, proxy to local services.
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const authServiceUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3004';
    const portfolioApiUrl = process.env.PORTFOLIO_API_URL ?? 'http://localhost:3006';
    const profileServiceUrl = process.env.PROFILE_SERVICE_URL ?? 'http://localhost:3007';
    return [
      { source: '/api/auth/:path*', destination: `${authServiceUrl}/api/auth/:path*` },
      { source: '/api/profile/:path*', destination: `${profileServiceUrl}/api/profile/:path*` },
      { source: '/api/portfolio/:path*', destination: `${portfolioApiUrl}/api/portfolio/:path*` },
      { source: '/api/stocks/:path*', destination: `${portfolioApiUrl}/api/stocks/:path*` },
      { source: '/api/signals/:path*', destination: `${portfolioApiUrl}/api/signals/:path*` },
      { source: '/api/predict/:path*', destination: `${portfolioApiUrl}/api/predict/:path*` },
      { source: '/api/market/:path*', destination: `${portfolioApiUrl}/api/market/:path*` },
      { source: '/api/news/:path*', destination: `${portfolioApiUrl}/api/news/:path*` },
    ];
  },
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

export default withSentryConfig(config, {
  org: 'yanatech-tech-limited',
  project: 'yana-stocks-frontend',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});

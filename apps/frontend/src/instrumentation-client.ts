import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  // Default is same-origin + localhost only, which silently excludes
  // NEXT_PUBLIC_API_URL's real prod host (api-gateway.yanatech.co.uk is a
  // different origin from stocks.yanatech.co.uk) — sentry-trace/baggage were
  // never attached to prod API calls without this. Kong's CORS plugin must
  // allow both headers for the same origin, or preflight rejects the request.
  tracePropagationTargets: ['localhost', /^\//, 'api-gateway.yanatech.co.uk'],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

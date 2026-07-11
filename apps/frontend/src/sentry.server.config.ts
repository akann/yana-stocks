import * as Sentry from '@sentry/nextjs';

// tracesSampleRate is deliberately 0 here (unlike the client config) — this
// service already runs its own hand-rolled OpenTelemetry NodeSDK
// (instrumentation.node.ts) exporting to Tempo. Sentry's tracing/performance
// integrations register their own OTel instrumentation on the same global
// provider, which risks double-instrumentation/duplicate spans. Until that's
// deliberately reconciled (see the yana-stocks NestJS OTel phase), this stays
// error-capture-only on the server side — no tracing, no span processors.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
});

import * as Sentry from '@sentry/nestjs';

// skipOpenTelemetrySetup: true — this service already runs its own hand-rolled
// OpenTelemetry NodeSDK (see tracing.ts) exporting to Tempo. Letting Sentry's
// default OTel auto-setup run too would create a second, conflicting global
// tracer provider. Instead tracing.ts wires Sentry's context
// manager/sampler/propagator directly into the existing NodeSDK — see the
// comment there for the full reasoning and the fallback if this doesn't hold
// up under real load.
export const sentryClient = Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 0,
});

import * as Sentry from '@sentry/nestjs';

// skipOpenTelemetrySetup: true — this service already runs its own hand-rolled
// OpenTelemetry NodeSDK (see tracing.ts) exporting to Tempo. Letting Sentry's
// default OTel auto-setup run too would create a second, conflicting global
// tracer provider. Instead tracing.ts wires Sentry's context manager and
// propagator directly into the existing NodeSDK — see the comment there for
// the full reasoning.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 0,
  // SentryPropagator only emits its own sentry-trace/baggage headers by
  // default — auth-service (Go) and the Python services don't understand
  // those, so an outgoing request to any of them would start a disconnected
  // trace on their end despite both sides auto-instrumenting HTTP. This
  // makes SentryPropagator also emit the standard traceparent header
  // alongside sentry-trace, which their default W3C propagators do read.
  propagateTraceparent: true,
});

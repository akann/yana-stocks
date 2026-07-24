// Sentry must init before the OTel NodeSDK below is constructed —
// skipOpenTelemetrySetup means Sentry won't start its own competing tracer
// provider.
import './instrument';

import { NodeSDK, core, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SentryContextManager } from '@sentry/nestjs';
import { SentryPropagator } from '@sentry/opentelemetry';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// Skip SDK init when no collector is configured (local dev without Tempo).
// OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT are set as env vars in k8s.
if (endpoint) {
  const sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      'service.version': process.env.npm_package_version ?? '0.0.0',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
    // Sentry-pilot wiring (see instrument.ts) — lets Sentry's error capture
    // participate in the same trace context as the existing Tempo pipeline
    // without running a second OTel setup. Deliberately no SentrySampler:
    // it drives root-span sampling off Sentry's own tracesSampleRate (0,
    // since this pilot is error-capture-only), which silently dropped every
    // trace bound for Tempo — confirmed via a live trace-volume check
    // (0 traces across all 4 Sentry-wired services vs 465/hr on
    // auth-service). No SentrySpanProcessor either — still error-capture-only.
    contextManager: new SentryContextManager(),
    // W3C TraceContext composed AFTER Sentry's propagator so that on extract
    // the standard traceparent header decides the remote parent — including
    // its sampling flag. SentryPropagator alone reads only sentry-trace, and
    // an error-only upstream (traces_sample_rate: 0 — every Go/Python service
    // here) always stamps sentry-trace "not sampled", which made the
    // parent-based sampler silently drop every Kafka consumer span the moment
    // producers began injecting headers (found live 2026-07-24). On inject it
    // also guarantees a traceparent regardless of Sentry client options.
    textMapPropagator: new core.CompositePropagator({
      propagators: [new SentryPropagator(), new core.W3CTraceContextPropagator()],
    }),
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: Error) => console.error('OTEL shutdown error:', err));
  });
}

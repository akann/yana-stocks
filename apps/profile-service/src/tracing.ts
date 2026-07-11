// Sentry must init before the OTel NodeSDK below is constructed — it needs
// to exist first so SentrySampler can wrap it, and skipOpenTelemetrySetup
// means Sentry won't start its own competing tracer provider.
import { sentryClient } from './instrument';

import { NodeSDK, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SentryContextManager } from '@sentry/nestjs';
import { SentryPropagator, SentrySampler } from '@sentry/opentelemetry';

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
    // without running a second OTel setup. No SentrySpanProcessor yet:
    // this pilot is deliberately error-capture-only until an observation
    // window confirms no regressions in Tempo trace volume/shape.
    contextManager: new SentryContextManager(),
    textMapPropagator: new SentryPropagator(),
    sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: Error) => console.error('OTEL shutdown error:', err));
  });
}

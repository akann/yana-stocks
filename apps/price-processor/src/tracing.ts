// Sentry must init before the OTel NodeSDK below is constructed — see
// profile-service/src/tracing.ts for the full reasoning.
import './instrument';

import { NodeSDK, resources } from '@opentelemetry/sdk-node';
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
        // High-cardinality noise with no debugging value in this service
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
    // Deliberately no SentrySampler — see profile-service/src/tracing.ts for
    // why (it drove root-span sampling off tracesSampleRate: 0 and silently
    // dropped every trace bound for Tempo).
    contextManager: new SentryContextManager(),
    textMapPropagator: new SentryPropagator(),
  });

  sdk.start();

  // Flush pending spans before the process exits.
  // k8s sends SIGTERM before SIGKILL; without this the last batch is dropped.
  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: Error) => console.error('OTEL shutdown error:', err));
  });
}

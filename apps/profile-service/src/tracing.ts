import { NodeSDK, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

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
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err: Error) => console.error('OTEL shutdown error:', err));
  });
}

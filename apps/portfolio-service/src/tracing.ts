// Sentry must init before the OTel NodeSDK below is constructed — see
// profile-service/src/tracing.ts for the full reasoning.
import { sentryClient } from './instrument';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SentryContextManager } from '@sentry/nestjs';
import { SentryPropagator, SentrySampler } from '@sentry/opentelemetry';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
  contextManager: new SentryContextManager(),
  textMapPropagator: new SentryPropagator(),
  sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
});

sdk.start();

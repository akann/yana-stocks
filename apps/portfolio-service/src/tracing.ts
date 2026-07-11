// Sentry must init before the OTel NodeSDK below is constructed — see
// profile-service/src/tracing.ts for the full reasoning.
import './instrument';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SentryContextManager } from '@sentry/nestjs';
import { SentryPropagator } from '@sentry/opentelemetry';

// Deliberately no SentrySampler — see profile-service/src/tracing.ts for why
// (it drove root-span sampling off tracesSampleRate: 0 and silently dropped
// every trace bound for Tempo).
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
  contextManager: new SentryContextManager(),
  textMapPropagator: new SentryPropagator(),
});

sdk.start();

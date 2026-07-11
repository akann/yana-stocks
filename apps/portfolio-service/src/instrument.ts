import * as Sentry from '@sentry/nestjs';

// See profile-service/src/instrument.ts (the OTel-pilot service this pattern
// was proven on first) for the full skipOpenTelemetrySetup reasoning.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 0,
});

// Package errtrack wires Sentry for error capture only — OTel/Tempo
// (internal/tracing) remains the sole tracer. TracesSampleRate: 0 mirrors the
// NestJS services' convention: Sentry still opens a transaction per request
// (via sentryhttp middleware) for scoping/context, but sampling it out means
// nothing is sent for it, so it never competes with or duplicates Tempo's
// trace volume.
package errtrack

import (
	"os"

	"github.com/getsentry/sentry-go"
	sentryotel "github.com/getsentry/sentry-go/otel"
)

// Setup initialises the Sentry client. No-op if SENTRY_DSN is unset, matching
// tracing.Setup's convention for local dev without a collector configured.
func Setup() error {
	dsn := os.Getenv("SENTRY_DSN")
	if dsn == "" {
		return nil
	}

	return sentry.Init(sentry.ClientOptions{
		Dsn:              dsn,
		Environment:      os.Getenv("NODE_ENV"),
		TracesSampleRate: 0,
		Integrations: func(integrations []sentry.Integration) []sentry.Integration {
			return append(integrations, sentryotel.NewOtelIntegration())
		},
	})
}

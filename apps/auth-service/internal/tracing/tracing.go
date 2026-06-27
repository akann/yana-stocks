package tracing

import (
	"context"
	"log"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Setup initialises the OTel tracer provider and returns a shutdown func.
// No-op (returns a nil-safe shutdown) if OTEL_EXPORTER_OTLP_ENDPOINT is not set.
func Setup(ctx context.Context) func(context.Context) error {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return func(context.Context) error { return nil }
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		log.Printf("OTEL: failed to create exporter, tracing disabled: %v", err)
		return func(context.Context) error { return nil }
	}

	res := sdkresource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(os.Getenv("OTEL_SERVICE_NAME")),
		semconv.DeploymentEnvironment(os.Getenv("NODE_ENV")),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown
}

package logging

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/trace"
)

// traceHandler wraps a slog.Handler and stamps trace_id/span_id from the
// active OTel span in ctx onto every record, when one exists.
type traceHandler struct {
	slog.Handler
}

func (h *traceHandler) Handle(ctx context.Context, record slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		record.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.Handler.Handle(ctx, record)
}

func (h *traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceHandler{h.Handler.WithAttrs(attrs)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{h.Handler.WithGroup(name)}
}

// Setup installs a JSON slog logger as the process default, tagged with the
// service name so log lines carry the same identifier tracing.go stamps on
// every span's resource attributes. Log lines emitted via the *Context slog
// variants (InfoContext, ErrorContext, ...) with a context carrying an
// active OTel span also get trace_id/span_id, so a log line can be
// correlated back to its trace in Tempo.
func Setup(serviceName string) {
	base := slog.NewJSONHandler(os.Stdout, nil)
	handler := &traceHandler{base}
	logger := slog.New(handler).With("service", serviceName)
	slog.SetDefault(logger)
}

// RequestLogger is a chi middleware that emits one structured JSON log line
// per request, replacing chi's own plain-text middleware.Logger.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.InfoContext(r.Context(), "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", chimw.GetReqID(r.Context()),
		)
	})
}

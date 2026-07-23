package logging

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// Setup installs a JSON slog logger as the process default, tagged with the
// service name so log lines carry the same identifier tracing.go stamps on
// every span's resource attributes.
func Setup(serviceName string) {
	handler := slog.NewJSONHandler(os.Stdout, nil)
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
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", chimw.GetReqID(r.Context()),
		)
	})
}

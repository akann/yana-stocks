// @title           Auth Service
// @version         1.0
// @description     JWT authentication, email verification, MFA, and account management for yana-stocks
// @BasePath        /
// @securityDefinitions.apikey BearerAuth
// @in              header
// @name            Authorization
// @description     JWT access token — prefix with "Bearer "
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/akann/yana-stocks/auth-service/internal/config"
	"github.com/akann/yana-stocks/auth-service/internal/db"
	"github.com/akann/yana-stocks/auth-service/internal/email"
	"github.com/akann/yana-stocks/auth-service/internal/handler"
	kafkapub "github.com/akann/yana-stocks/auth-service/internal/kafka"
	"github.com/akann/yana-stocks/auth-service/internal/middleware"
	"github.com/akann/yana-stocks/auth-service/internal/service"
	"github.com/akann/yana-stocks/auth-service/internal/tracing"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()
	ctx := context.Background()

	// Tracing
	shutdownTracing := tracing.Setup(ctx)
	defer func() {
		tracingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTracing(tracingCtx); err != nil {
			log.Printf("OTEL shutdown error: %v", err)
		}
	}()

	// Database
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer pool.Close()

	queries := db.New(pool)

	// Redis
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis URL parse failed: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	// Email
	emailer := email.NewSender(cfg.EmailAPIURL, cfg.EmailAPIKey)

	// Kafka
	publisher := kafkapub.NewPublisher(cfg.KafkaBrokers)
	defer publisher.Close()

	// Service & handler
	authSvc := service.NewAuthService(cfg, queries, rdb, emailer, publisher)
	authHandler := handler.NewAuthHandler(authSvc)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/verify", authHandler.Verify)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/logout", authHandler.Logout)
		r.Post("/password/reset-request", authHandler.RequestPasswordReset)
		r.Post("/password/reset", authHandler.ResetPassword)
		r.Post("/mfa/verify", authHandler.VerifyMFALogin)

		// JWT-protected
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(cfg.JWTSecret))
			r.Get("/me", authHandler.Me)
			r.Put("/password", authHandler.ChangePassword)
			r.Delete("/account", authHandler.DeleteAccount)
			r.Get("/mfa", authHandler.GetMFAStatus)
			r.Post("/mfa/setup", authHandler.SetupMFA)
			r.Post("/mfa/enable", authHandler.EnableMFA)
			r.Delete("/mfa", authHandler.DisableMFA)
		})
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      otelhttp.NewHandler(r, "auth-service"),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("auth-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	log.Println("auth-service stopped")
}

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
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	// Database
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	ctx := context.Background()
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
	emailer := email.NewSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPFrom)

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

		// JWT-protected
		r.Group(func(r chi.Router) {
			r.Use(middleware.JWTAuth(cfg.JWTSecret))
			r.Get("/me", authHandler.Me)
			r.Put("/password", authHandler.ChangePassword)
			r.Delete("/account", authHandler.DeleteAccount)
		})
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
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

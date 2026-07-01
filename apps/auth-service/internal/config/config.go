package config

import (
	"os"
	"time"
)

type Config struct {
	Port string

	DatabaseURL string

	RedisURL string

	JWTSecret            string
	JWTExpiresIn         time.Duration
	JWTRefreshExpiresIn  time.Duration

	KafkaBrokers string

	FrontendURL string

	EmailAPIURL string
	EmailAPIKey string
}

func Load() *Config {
	jwtExpiry, _ := time.ParseDuration(getEnv("JWT_EXPIRES_IN", "15m"))
	refreshExpiry, _ := time.ParseDuration(getEnv("JWT_REFRESH_EXPIRES_IN", "168h"))

	return &Config{
		Port:                getEnv("PORT", "3004"),
		DatabaseURL:         mustEnv("DATABASE_URL"),
		RedisURL:            getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:           mustEnv("JWT_SECRET"),
		JWTExpiresIn:        jwtExpiry,
		JWTRefreshExpiresIn: refreshExpiry,
		KafkaBrokers:        getEnv("KAFKA_BROKERS", "localhost:19092"),
		FrontendURL:         getEnv("FRONTEND_URL", "http://localhost:3000"),
		EmailAPIURL:         getEnv("EMAIL_API_URL", "https://api-gateway.yanatech.co.uk/api/email/send"),
		EmailAPIKey:         getEnv("EMAIL_API_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic("required env var not set: " + key)
	}
	return v
}

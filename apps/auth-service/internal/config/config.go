package config

import (
	"os"
	"strconv"
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

	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
}

func Load() *Config {
	smtpPort, _ := strconv.Atoi(getEnv("SMTP_PORT", "2525"))

	jwtExpiry, _ := time.ParseDuration(getEnv("JWT_EXPIRES_IN", "15m"))
	refreshExpiry, _ := time.ParseDuration(getEnv("JWT_REFRESH_EXPIRES_IN", "168h"))

	return &Config{
		Port:                getEnv("PORT", "8080"),
		DatabaseURL:         mustEnv("DATABASE_URL"),
		RedisURL:            getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:           mustEnv("JWT_SECRET"),
		JWTExpiresIn:        jwtExpiry,
		JWTRefreshExpiresIn: refreshExpiry,
		KafkaBrokers:        getEnv("KAFKA_BROKERS", "localhost:19092"),
		FrontendURL:         getEnv("FRONTEND_URL", "http://localhost:3000"),
		SMTPHost:            getEnv("SMTP_HOST", "mail-eu.smtp2go.com"),
		SMTPPort:            smtpPort,
		SMTPUsername:        getEnv("SMTP_USERNAME", ""),
		SMTPPassword:        getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:            getEnv("SMTP_FROM", "info@yanatech.co.uk"),
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

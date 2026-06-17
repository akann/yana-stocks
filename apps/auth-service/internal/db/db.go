package db

import (
	"context"
	"embed"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type User struct {
	ID                string
	Email             string
	PasswordHash      string
	IsVerified        bool
	VerificationToken *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	return pgxpool.NewWithConfig(ctx, cfg)
}

func RunMigrations(databaseURL string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, databaseURL)
	if err != nil {
		return err
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}
	return nil
}

// Queries wraps a pool and provides typed query methods.
type Queries struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Queries {
	return &Queries{pool: pool}
}

func (q *Queries) CreateUser(ctx context.Context, email, passwordHash, verificationToken string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, verification_token)
		VALUES ($1, $2, $3)
		RETURNING id, email, password_hash, is_verified, verification_token, created_at, updated_at
	`, email, passwordHash, verificationToken)
	return scanUser(row)
}

func (q *Queries) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, is_verified, verification_token, created_at, updated_at
		FROM users WHERE email = $1
	`, email)
	return scanUser(row)
}

func (q *Queries) GetUserByID(ctx context.Context, id string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, is_verified, verification_token, created_at, updated_at
		FROM users WHERE id = $1
	`, id)
	return scanUser(row)
}

func (q *Queries) GetUserByVerificationToken(ctx context.Context, token string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, is_verified, verification_token, created_at, updated_at
		FROM users WHERE verification_token = $1
	`, token)
	return scanUser(row)
}

func (q *Queries) VerifyUser(ctx context.Context, id string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE users SET is_verified = true, verification_token = NULL, updated_at = NOW()
		WHERE id = $1
	`, id)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanUser(row scanner) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.IsVerified, &u.VerificationToken, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

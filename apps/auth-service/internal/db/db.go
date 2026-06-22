package db

import (
	"context"
	"embed"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type User struct {
	ID                string
	Email             string
	IsVerified        bool
	VerificationToken *string
	MFAEnabled        bool
	MFASecret         *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// UserWithCredential is returned by login queries that need the password hash.
type UserWithCredential struct {
	User
	PasswordHash string
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

// CreateUserWithCredential inserts a user + password credential in one transaction.
func (q *Queries) CreateUserWithCredential(ctx context.Context, email, passwordHash, verificationToken string) (*User, error) {
	tx, err := q.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx, `
		INSERT INTO users (email, verification_token)
		VALUES ($1, $2)
		RETURNING id, email, is_verified, verification_token, mfa_enabled, mfa_secret, created_at, updated_at
	`, email, verificationToken)
	user, err := scanUser(row)
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
	`, user.ID, passwordHash)
	if err != nil {
		return nil, err
	}

	return user, tx.Commit(ctx)
}

func (q *Queries) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, is_verified, verification_token, mfa_enabled, mfa_secret, created_at, updated_at
		FROM users WHERE email = $1
	`, email)
	return scanUser(row)
}

// GetUserByEmailWithCredential returns the user and their password hash for login.
func (q *Queries) GetUserByEmailWithCredential(ctx context.Context, email string) (*UserWithCredential, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.is_verified, u.verification_token, u.mfa_enabled, u.mfa_secret, u.created_at, u.updated_at,
		       uc.password_hash
		FROM users u
		JOIN user_credentials uc ON uc.user_id = u.id
		WHERE u.email = $1
	`, email)
	u := &UserWithCredential{}
	err := row.Scan(
		&u.ID, &u.Email, &u.IsVerified, &u.VerificationToken, &u.MFAEnabled, &u.MFASecret,
		&u.CreatedAt, &u.UpdatedAt, &u.PasswordHash,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (q *Queries) GetUserByID(ctx context.Context, id string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, is_verified, verification_token, mfa_enabled, mfa_secret, created_at, updated_at
		FROM users WHERE id = $1
	`, id)
	return scanUser(row)
}

func (q *Queries) GetUserByVerificationToken(ctx context.Context, token string) (*User, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT id, email, is_verified, verification_token, mfa_enabled, mfa_secret, created_at, updated_at
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

func (q *Queries) GetUserWithCredentialByID(ctx context.Context, userID string) (*UserWithCredential, error) {
	row := q.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.is_verified, u.verification_token, u.mfa_enabled, u.mfa_secret, u.created_at, u.updated_at,
		       uc.password_hash
		FROM users u
		JOIN user_credentials uc ON uc.user_id = u.id
		WHERE u.id = $1
	`, userID)
	u := &UserWithCredential{}
	err := row.Scan(
		&u.ID, &u.Email, &u.IsVerified, &u.VerificationToken, &u.MFAEnabled, &u.MFASecret,
		&u.CreatedAt, &u.UpdatedAt, &u.PasswordHash,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (q *Queries) UpdatePasswordHash(ctx context.Context, userID, passwordHash string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE user_credentials SET password_hash = $1, updated_at = NOW() WHERE user_id = $2
	`, passwordHash, userID)
	return err
}

func (q *Queries) DeleteUser(ctx context.Context, id string) error {
	_, err := q.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func (q *Queries) GetMFAStatus(ctx context.Context, userID string) (bool, error) {
	var enabled bool
	err := q.pool.QueryRow(ctx, `SELECT mfa_enabled FROM users WHERE id = $1`, userID).Scan(&enabled)
	return enabled, err
}

func (q *Queries) SetMFASecret(ctx context.Context, userID, secret string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE users SET mfa_secret = $1, mfa_enabled = TRUE, updated_at = NOW() WHERE id = $2
	`, secret, userID)
	return err
}

func (q *Queries) ClearMFA(ctx context.Context, userID string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE users SET mfa_secret = NULL, mfa_enabled = FALSE, updated_at = NOW() WHERE id = $1
	`, userID)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanUser(row scanner) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.Email, &u.IsVerified, &u.VerificationToken, &u.MFAEnabled, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

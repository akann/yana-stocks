CREATE SCHEMA IF NOT EXISTS auth;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Identity only — no auth mechanism details
CREATE TABLE IF NOT EXISTS users (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT        NOT NULL UNIQUE,
  is_verified          BOOLEAN     NOT NULL DEFAULT false,
  verification_token   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Password auth (absent for OAuth-only users)
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id      UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth provider links (one row per provider per user)
CREATE TABLE IF NOT EXISTS user_oauth (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT        NOT NULL,
  provider_id    TEXT        NOT NULL,
  provider_email TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users (verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_oauth_user_id ON user_oauth (user_id);

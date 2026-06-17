CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT        NOT NULL UNIQUE,
  password_hash        TEXT        NOT NULL,
  is_verified          BOOLEAN     NOT NULL DEFAULT false,
  verification_token   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users (verification_token) WHERE verification_token IS NOT NULL;

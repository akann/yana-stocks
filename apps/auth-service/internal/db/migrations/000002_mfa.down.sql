ALTER TABLE auth.users DROP COLUMN IF EXISTS mfa_enabled;
ALTER TABLE auth.users DROP COLUMN IF EXISTS mfa_secret;

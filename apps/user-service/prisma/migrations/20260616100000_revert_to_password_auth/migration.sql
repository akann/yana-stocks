-- Revert from Authentik-based auth to direct password auth
-- Existing Authentik-linked profiles have no passwords and cannot be migrated.
DELETE FROM "user_profiles";

ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_authentikId_key";
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "authentikId";

ALTER TABLE "user_profiles" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "user_profiles" ALTER COLUMN "passwordHash" DROP DEFAULT;
ALTER TABLE "user_profiles" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_profiles" ADD COLUMN "verificationToken" TEXT;
ALTER TABLE "user_profiles" ADD COLUMN "verificationTokenExpiry" TIMESTAMP(3);

CREATE UNIQUE INDEX "user_profiles_verificationToken_key" ON "user_profiles"("verificationToken");

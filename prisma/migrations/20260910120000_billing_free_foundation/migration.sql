-- Billing foundation. This migration creates identity and free-management evidence without
-- enabling purchases or changing the existing quota gates.

CREATE TYPE "BillingProviderIdentityKind" AS ENUM ('CANONICAL', 'ALIAS');
CREATE TYPE "BillingProviderIdentityStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "FreeManagementGrantSource" AS ENUM ('INITIAL_FREE', 'PAID_EXPIRATION', 'MIGRATION_SELECTION', 'MIGRATION_FALLBACK', 'SUPPORT');
CREATE TYPE "FreeManagementGrantEndReason" AS ENUM ('DIVISION_DELETED', 'PAID_CONVERSION', 'ENTERPRISE_ACTIVATED', 'ACCOUNT_DELETED', 'ACCOUNT_RECOVERY_REPLACED', 'SUPPORT_REPLACED');

CREATE TABLE "billing_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "ownerUserIdSnapshot" TEXT NOT NULL,
  "detachedAt" TIMESTAMP(3),
  "detachReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_provider_identities" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "revenueCatAppUserId" TEXT NOT NULL,
  "kind" "BillingProviderIdentityKind" NOT NULL,
  "status" "BillingProviderIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "observedAsOriginal" BOOLEAN NOT NULL DEFAULT false,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_provider_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_provider_identities_status_dates_check" CHECK (
    ("status" = 'ACTIVE' AND "retiredAt" IS NULL)
    OR ("status" = 'RETIRED' AND "retiredAt" IS NOT NULL)
  )
);

CREATE TABLE "free_management_grants" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "billingAccountId" TEXT,
  "divisionId" TEXT,
  "divisionIdSnapshot" TEXT NOT NULL,
  "divisionNameSnapshot" TEXT NOT NULL,
  "leagueId" TEXT,
  "leagueIdSnapshot" TEXT NOT NULL,
  "leagueNameSnapshot" TEXT NOT NULL,
  "source" "FreeManagementGrantSource" NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endReason" "FreeManagementGrantEndReason",
  "convertedToBillingPeriodId" TEXT,
  "convertedToAssignmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "free_management_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "free_management_grants_end_state_check" CHECK (
    ("endedAt" IS NULL AND "endReason" IS NULL)
    OR ("endedAt" IS NOT NULL AND "endReason" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "billing_accounts_userId_key" ON "billing_accounts"("userId");
CREATE INDEX "billing_accounts_ownerUserIdSnapshot_idx" ON "billing_accounts"("ownerUserIdSnapshot");
CREATE UNIQUE INDEX "billing_provider_identities_revenueCatAppUserId_key" ON "billing_provider_identities"("revenueCatAppUserId");
CREATE INDEX "billing_provider_identities_billingAccountId_status_idx" ON "billing_provider_identities"("billingAccountId", "status");
CREATE UNIQUE INDEX "billing_provider_identities_canonical_key"
  ON "billing_provider_identities"("billingAccountId") WHERE "kind" = 'CANONICAL';
CREATE UNIQUE INDEX "free_management_grants_active_user_key"
  ON "free_management_grants"("userId") WHERE "endedAt" IS NULL AND "userId" IS NOT NULL;
CREATE INDEX "free_management_grants_userId_endedAt_idx" ON "free_management_grants"("userId", "endedAt");
CREATE INDEX "free_management_grants_billingAccountId_endedAt_idx" ON "free_management_grants"("billingAccountId", "endedAt");
CREATE INDEX "free_management_grants_divisionId_idx" ON "free_management_grants"("divisionId");
CREATE INDEX "free_management_grants_leagueId_idx" ON "free_management_grants"("leagueId");

ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_provider_identities" ADD CONSTRAINT "billing_provider_identities_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_management_grants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_management_grants_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_management_grants_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_management_grants_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "ligas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_canonical_billing_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."kind" = 'CANONICAL' AND NEW."revenueCatAppUserId" <> NEW."billingAccountId" THEN
    RAISE EXCEPTION 'canonical RevenueCat identity must equal billing account id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_provider_identity_canonical_check"
BEFORE INSERT OR UPDATE ON "billing_provider_identities"
FOR EACH ROW EXECUTE FUNCTION enforce_canonical_billing_identity();

-- There are no grandfathered multi-division accounts at this launch stage. Fail the deployment
-- instead of silently activating free gates without the BillingMigrationAccess model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User" u
    JOIN "ligas" l ON l."userId" = u."id"
    JOIN "divisiones" d ON d."ligaId" = l."id"
    WHERE u."rol" = 'LIGA'
    GROUP BY u."id"
    HAVING COUNT(d."id") > 1
  ) THEN
    RAISE EXCEPTION 'billing foundation requires BillingMigrationAccess for LIGA accounts with more than one division';
  END IF;
END;
$$;

-- Deterministic IDs make the data migration safe to inspect and rerun in a restored environment.
INSERT INTO "billing_accounts" ("id", "userId", "ownerUserIdSnapshot", "updatedAt")
SELECT 'billing_' || md5('tenka-billing-account:' || u."id"), u."id", u."id", CURRENT_TIMESTAMP
FROM "User" u
WHERE u."rol" = 'LIGA'
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "billing_provider_identities" (
  "id", "billingAccountId", "revenueCatAppUserId", "kind", "status", "observedAsOriginal"
)
SELECT 'identity_' || md5('tenka-billing-identity:' || b."id"), b."id", b."id", 'CANONICAL', 'ACTIVE', true
FROM "billing_accounts" b
ON CONFLICT ("revenueCatAppUserId") DO NOTHING;

WITH single_division_accounts AS (
  SELECT
    b."id" AS "billingAccountId",
    b."userId",
    MIN(d."id") AS "divisionId"
  FROM "billing_accounts" b
  JOIN "ligas" l ON l."userId" = b."userId"
  JOIN "divisiones" d ON d."ligaId" = l."id"
  WHERE b."userId" IS NOT NULL
  GROUP BY b."id", b."userId"
  HAVING COUNT(d."id") = 1
)
INSERT INTO "free_management_grants" (
  "id", "userId", "billingAccountId", "divisionId", "divisionIdSnapshot",
  "divisionNameSnapshot", "leagueId", "leagueIdSnapshot", "leagueNameSnapshot", "source"
)
SELECT
  'free_grant_' || md5('tenka-initial-free-grant:' || s."billingAccountId"),
  s."userId",
  s."billingAccountId",
  d."id",
  d."id",
  d."nombre",
  l."id",
  l."id",
  l."nombre",
  'INITIAL_FREE'
FROM single_division_accounts s
JOIN "divisiones" d ON d."id" = s."divisionId"
JOIN "ligas" l ON l."id" = d."ligaId"
ON CONFLICT DO NOTHING;

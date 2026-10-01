CREATE TYPE "BillingMigrationActivationReviewStatus" AS ENUM (
  'PENDING_REVIEW', 'APPROVED', 'BLOCKED', 'REJECTED', 'INVALIDATED', 'COMPLETED', 'EXPIRED'
);
CREATE TYPE "BillingMigrationActivationItemStatus" AS ENUM ('ELIGIBLE', 'BLOCKED', 'ACTIVATED');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_CREATED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_BLOCKED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_VIEWED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_APPROVED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_REJECTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_EXPIRED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_INVALIDATED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_ATTEMPT_BLOCKED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATION_REVIEW_COMPLETED';

CREATE TABLE "billing_migration_activation_reviews" (
  "id" TEXT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "status" "BillingMigrationActivationReviewStatus" NOT NULL,
  "cohortHash" TEXT NOT NULL,
  "cohortCount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedByAdminIdSnapshot" TEXT NOT NULL,
  "approvedByAdminIdSnapshot" TEXT,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "approvedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "operationalControlVersion" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_migration_activation_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_migration_activation_reviews_hash_check" CHECK ("cohortHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "billing_migration_activation_reviews_count_check" CHECK ("cohortCount" BETWEEN 1 AND 10),
  CONSTRAINT "billing_migration_activation_reviews_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500),
  CONSTRAINT "billing_migration_activation_reviews_expiry_check" CHECK ("expiresAt" > "requestedAt"),
  CONSTRAINT "billing_migration_activation_reviews_version_check" CHECK ("version" > 0),
  CONSTRAINT "billing_migration_activation_reviews_approval_check" CHECK (
    ("status" NOT IN ('APPROVED', 'COMPLETED') OR ("approvedAt" IS NOT NULL AND "approvedByAdminIdSnapshot" IS NOT NULL))
    AND (("approvedAt" IS NULL) = ("approvedByAdminIdSnapshot" IS NULL))
    AND ("approvedByAdminIdSnapshot" IS NULL OR "approvedByAdminIdSnapshot" <> "requestedByAdminIdSnapshot")
  )
);

CREATE TABLE "billing_migration_activation_review_items" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "migrationAccessId" TEXT,
  "stateFingerprint" TEXT NOT NULL,
  "eligibilityStatus" "BillingMigrationActivationItemStatus" NOT NULL,
  "blockerCodes" JSONB NOT NULL,
  "preparedDivisionCount" INTEGER NOT NULL,
  "liveDivisionCount" INTEGER NOT NULL,
  "activatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_migration_activation_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_migration_review_items_review_fkey" FOREIGN KEY ("reviewId")
    REFERENCES "billing_migration_activation_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_migration_review_items_migration_fkey" FOREIGN KEY ("migrationAccessId")
    REFERENCES "billing_migration_accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_migration_activation_review_items_hash_check" CHECK ("stateFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "billing_migration_activation_review_items_counts_check" CHECK (
    "preparedDivisionCount" >= 0 AND "liveDivisionCount" >= 0 AND "liveDivisionCount" <= "preparedDivisionCount"
    AND ("eligibilityStatus" <> 'ELIGIBLE' OR ("migrationAccessId" IS NOT NULL AND "preparedDivisionCount" > 1))
  ),
  CONSTRAINT "billing_migration_activation_review_items_status_check" CHECK (
    ("eligibilityStatus" = 'ACTIVATED') = ("activatedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "billing_migration_review_items_review_account_key"
  ON "billing_migration_activation_review_items"("reviewId", "billingAccountId");
CREATE UNIQUE INDEX "billing_migration_review_items_review_migration_key"
  ON "billing_migration_activation_review_items"("reviewId", "migrationAccessId");
CREATE INDEX "billing_migration_activation_reviews_status_expiry_idx"
  ON "billing_migration_activation_reviews"("status", "expiresAt", "id");
CREATE INDEX "billing_migration_reviews_env_status_requested_idx"
  ON "billing_migration_activation_reviews"("environment", "status", "requestedAt" DESC, "id" DESC);
CREATE INDEX "billing_migration_review_items_review_status_idx"
  ON "billing_migration_activation_review_items"("reviewId", "eligibilityStatus", "id");
CREATE INDEX "billing_migration_review_items_account_review_idx"
  ON "billing_migration_activation_review_items"("billingAccountId", "reviewId");

ALTER TABLE "billing_migration_accesses" ADD COLUMN "activationReviewItemId" TEXT;
CREATE UNIQUE INDEX "billing_migration_accesses_activationReviewItemId_key"
  ON "billing_migration_accesses"("activationReviewItemId");
ALTER TABLE "billing_migration_accesses"
  ADD CONSTRAINT "billing_migrations_activation_review_item_fkey"
  FOREIGN KEY ("activationReviewItemId") REFERENCES "billing_migration_activation_review_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_billing_migration_activation_review_item_count()
RETURNS trigger AS $$
DECLARE
  target_review_id TEXT;
  expected_count INTEGER;
  actual_count INTEGER;
BEGIN
  target_review_id := COALESCE(NEW."reviewId", OLD."reviewId");
  SELECT "cohortCount" INTO expected_count FROM "billing_migration_activation_reviews" WHERE "id" = target_review_id;
  SELECT COUNT(*) INTO actual_count FROM "billing_migration_activation_review_items" WHERE "reviewId" = target_review_id;
  IF expected_count IS NOT NULL AND actual_count <> expected_count THEN
    RAISE EXCEPTION 'billing migration activation review item count mismatch';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER billing_migration_activation_review_item_count
AFTER INSERT OR UPDATE OR DELETE ON "billing_migration_activation_review_items"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION enforce_billing_migration_activation_review_item_count();

CREATE OR REPLACE FUNCTION prevent_billing_migration_activation_review_item_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."reviewId" IS DISTINCT FROM OLD."reviewId"
    OR NEW."billingAccountId" IS DISTINCT FROM OLD."billingAccountId"
    OR NEW."migrationAccessId" IS DISTINCT FROM OLD."migrationAccessId"
    OR NEW."stateFingerprint" IS DISTINCT FROM OLD."stateFingerprint"
    OR NEW."blockerCodes" IS DISTINCT FROM OLD."blockerCodes"
    OR NEW."preparedDivisionCount" IS DISTINCT FROM OLD."preparedDivisionCount"
    OR NEW."liveDivisionCount" IS DISTINCT FROM OLD."liveDivisionCount"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NOT (NEW."eligibilityStatus" = OLD."eligibilityStatus"
      OR (OLD."eligibilityStatus" = 'ELIGIBLE' AND NEW."eligibilityStatus" = 'ACTIVATED')) THEN
    RAISE EXCEPTION 'billing migration activation review items are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_migration_activation_review_items_immutable
BEFORE UPDATE OR DELETE ON "billing_migration_activation_review_items"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_activation_review_item_mutation();

CREATE OR REPLACE FUNCTION prevent_billing_migration_activation_review_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."environment" IS DISTINCT FROM OLD."environment"
    OR NEW."cohortHash" IS DISTINCT FROM OLD."cohortHash"
    OR NEW."cohortCount" IS DISTINCT FROM OLD."cohortCount"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."requestedByAdminIdSnapshot" IS DISTINCT FROM OLD."requestedByAdminIdSnapshot"
    OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."operationalControlVersion" IS DISTINCT FROM OLD."operationalControlVersion"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NOT (NEW."status" = OLD."status"
      OR (OLD."status" = 'PENDING_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED', 'EXPIRED'))
      OR (OLD."status" = 'BLOCKED' AND NEW."status" = 'EXPIRED')
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('INVALIDATED', 'COMPLETED', 'EXPIRED')))
    OR (OLD."approvedAt" IS NOT NULL AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt")
    OR (OLD."approvedByAdminIdSnapshot" IS NOT NULL
      AND NEW."approvedByAdminIdSnapshot" IS DISTINCT FROM OLD."approvedByAdminIdSnapshot") THEN
    RAISE EXCEPTION 'billing migration activation review is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_migration_activation_reviews_immutable
BEFORE UPDATE OR DELETE ON "billing_migration_activation_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_activation_review_mutation();

CREATE OR REPLACE FUNCTION prevent_billing_migration_activation_provenance_mutation()
RETURNS trigger AS $$
DECLARE linked_migration_id TEXT;
BEGIN
  IF OLD."activationReviewItemId" IS NOT NULL
    AND NEW."activationReviewItemId" IS DISTINCT FROM OLD."activationReviewItemId" THEN
    RAISE EXCEPTION 'billing migration activation provenance is immutable';
  END IF;
  IF NEW."activationReviewItemId" IS NOT NULL THEN
    SELECT "migrationAccessId" INTO linked_migration_id
    FROM "billing_migration_activation_review_items" WHERE "id" = NEW."activationReviewItemId";
    IF linked_migration_id IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'billing migration activation provenance does not match migration';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_migration_accesses_activation_provenance_immutable
BEFORE UPDATE ON "billing_migration_accesses"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_activation_provenance_mutation();

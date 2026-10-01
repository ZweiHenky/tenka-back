ALTER TYPE "BillingMigrationAccessStatus" ADD VALUE 'SELECTION_REQUIRED';
ALTER TYPE "BillingMigrationAccessStatus" ADD VALUE 'SELECTED';
ALTER TYPE "BillingMigrationAccessStatus" ADD VALUE 'PURCHASED';
ALTER TYPE "BillingMigrationAccessStatus" ADD VALUE 'APPLIED';
ALTER TYPE "BillingMigrationAccessStatus" ADD VALUE 'REPLACED';

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_ACTIVATED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_FREE_DIVISION_SELECTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_PURCHASED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_APPLIED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_PAUSE_OPENED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MIGRATION_PAUSE_CLOSED';

ALTER TABLE "billing_migration_accesses"
  DROP CONSTRAINT "billing_migration_accesses_prepared_state_check",
  ADD CONSTRAINT "billing_migration_accesses_lifecycle_check" CHECK (
    "preparedDivisionCount" > 1
    AND (
      ("status" = 'PREPARED' AND "selectedFreeDivisionIdSnapshot" IS NULL
        AND "startedAt" IS NULL AND "deadline" IS NULL AND "activatedAt" IS NULL AND "appliedAt" IS NULL)
      OR
      ("status" = 'SELECTION_REQUIRED' AND "selectedFreeDivisionIdSnapshot" IS NULL
        AND "startedAt" IS NOT NULL AND "deadline" > "startedAt"
        AND "activatedAt" IS NOT NULL AND "appliedAt" IS NULL)
      OR
      ("status" = 'SELECTED' AND "selectedFreeDivisionIdSnapshot" IS NOT NULL
        AND "startedAt" IS NOT NULL AND "deadline" > "startedAt"
        AND "activatedAt" IS NOT NULL AND "appliedAt" IS NULL)
      OR
      ("status" = 'PURCHASED' AND "startedAt" IS NOT NULL AND "deadline" > "startedAt"
        AND "activatedAt" IS NOT NULL AND "appliedAt" IS NULL)
      OR
      ("status" IN ('APPLIED', 'REPLACED') AND "startedAt" IS NOT NULL
        AND "deadline" > "startedAt" AND "activatedAt" IS NOT NULL AND "appliedAt" IS NOT NULL)
    )
  );

ALTER TABLE "billing_migration_accesses"
  ADD CONSTRAINT "billing_migration_accesses_selected_snapshot_fkey"
  FOREIGN KEY ("id", "selectedFreeDivisionIdSnapshot")
  REFERENCES "billing_migration_divisions"("migrationAccessId", "divisionIdSnapshot")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_billing_migration_access_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."billingAccountId" IS DISTINCT FROM OLD."billingAccountId"
    OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
    OR NEW."preparedDivisionCount" IS DISTINCT FROM OLD."preparedDivisionCount"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'billing migration preparation identity is immutable';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'billing migration start is immutable';
  END IF;
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'billing migration activation is immutable';
  END IF;
  IF OLD."selectedFreeDivisionIdSnapshot" IS NOT NULL
    AND NEW."selectedFreeDivisionIdSnapshot" IS DISTINCT FROM OLD."selectedFreeDivisionIdSnapshot" THEN
    RAISE EXCEPTION 'billing migration free selection is immutable';
  END IF;
  IF OLD."appliedAt" IS NOT NULL AND NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt" THEN
    RAISE EXCEPTION 'billing migration application is immutable';
  END IF;
  IF OLD."deadline" IS NOT NULL AND (NEW."deadline" IS NULL OR NEW."deadline" < OLD."deadline") THEN
    RAISE EXCEPTION 'billing migration deadline cannot decrease';
  END IF;
  IF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'PREPARED' AND NEW."status" = 'SELECTION_REQUIRED')
    OR (OLD."status" = 'SELECTION_REQUIRED' AND NEW."status" IN ('SELECTED', 'PURCHASED', 'APPLIED', 'REPLACED'))
    OR (OLD."status" = 'SELECTED' AND NEW."status" IN ('PURCHASED', 'APPLIED', 'REPLACED'))
    OR (OLD."status" = 'PURCHASED' AND NEW."status" IN ('APPLIED', 'REPLACED'))
  ) THEN
    RAISE EXCEPTION 'invalid billing migration status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "billing_operational_pauses" (
  "id" TEXT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "endedAt" TIMESTAMPTZ(3),
  "startedByAdminId" TEXT NOT NULL,
  "endedByAdminId" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_operational_pauses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_operational_pauses_interval_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt"),
  CONSTRAINT "billing_operational_pauses_end_actor_check" CHECK (("endedAt" IS NULL) = ("endedByAdminId" IS NULL)),
  CONSTRAINT "billing_operational_pauses_control_fkey" FOREIGN KEY ("environment")
    REFERENCES "billing_operational_controls"("environment") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_operational_pauses_one_open_key"
  ON "billing_operational_pauses"("environment") WHERE "endedAt" IS NULL;
CREATE INDEX "billing_operational_pauses_environment_started_idx"
  ON "billing_operational_pauses"("environment", "startedAt");

CREATE TABLE "billing_migration_pause_applications" (
  "id" TEXT NOT NULL,
  "billingMigrationAccessId" TEXT NOT NULL,
  "billingOperationalPauseId" TEXT NOT NULL,
  "extensionSeconds" INTEGER NOT NULL,
  "appliedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_migration_pause_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_migration_pause_applications_extension_check" CHECK ("extensionSeconds" > 0),
  CONSTRAINT "billing_migration_pause_applications_access_fkey" FOREIGN KEY ("billingMigrationAccessId")
    REFERENCES "billing_migration_accesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_migration_pause_applications_pause_fkey" FOREIGN KEY ("billingOperationalPauseId")
    REFERENCES "billing_operational_pauses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_migration_pause_applications_access_pause_key"
  ON "billing_migration_pause_applications"("billingMigrationAccessId", "billingOperationalPauseId");

ALTER TABLE "free_management_grants" ADD COLUMN "sourceBillingMigrationAccessId" TEXT;
CREATE UNIQUE INDEX "free_management_grants_source_migration_key"
  ON "free_management_grants"("sourceBillingMigrationAccessId");
ALTER TABLE "free_management_grants"
  ADD CONSTRAINT "free_management_grants_source_migration_fkey"
  FOREIGN KEY ("sourceBillingMigrationAccessId") REFERENCES "billing_migration_accesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_billing_operational_pause_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."environment" IS DISTINCT FROM OLD."environment"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."startedByAdminId" IS DISTINCT FROM OLD."startedByAdminId"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD."endedAt" IS NOT NULL AND (NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
      OR NEW."endedByAdminId" IS DISTINCT FROM OLD."endedByAdminId")) THEN
    RAISE EXCEPTION 'billing operational pause history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_operational_pauses_immutable
BEFORE UPDATE OR DELETE ON "billing_operational_pauses"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_operational_pause_mutation();

CREATE OR REPLACE FUNCTION prevent_billing_migration_pause_application_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing migration pause applications are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_migration_pause_applications_append_only
BEFORE UPDATE OR DELETE ON "billing_migration_pause_applications"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_migration_pause_application_mutation();

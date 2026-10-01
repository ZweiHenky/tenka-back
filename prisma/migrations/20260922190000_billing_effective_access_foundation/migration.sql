-- Effective paid-access primitives. Runtime access remains unchanged until explicitly enabled.
CREATE TYPE "BillingPeriodOrigin" AS ENUM ('STORE');
CREATE TYPE "BillingPeriodEndReason" AS ENUM ('SUPERSEDED', 'REFUND', 'REVOCATION', 'CHARGEBACK', 'FRAUD', 'PROVIDER_CORRECTION');
CREATE TYPE "DivisionCapacityAssignmentSource" AS ENUM (
  'FREE_CONVERSION', 'PURCHASE_SELECTION', 'PURCHASE_FALLBACK', 'DIRECT',
  'PERIOD_ROLLOVER', 'GRACE_RECOVERY', 'RENEWAL_SELECTION', 'RENEWAL_FALLBACK'
);

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PERIOD_MATERIALIZED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PERIOD_SUPERSEDED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PERIOD_ENDED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CAPACITY_GRANTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_DIVISION_ASSIGNED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_MATERIALIZATION_BLOCKED';

CREATE TABLE "billing_periods" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "source" "BillingPeriodOrigin" NOT NULL DEFAULT 'STORE',
  "materializationKey" TEXT NOT NULL,
  "logicalProductIdSnapshot" TEXT NOT NULL,
  "capacityAtStart" INTEGER NOT NULL,
  "billingIntervalAtStart" "BillingInterval" NOT NULL,
  "effectiveStart" TIMESTAMPTZ(3) NOT NULL,
  "effectiveEnd" TIMESTAMPTZ(3) NOT NULL,
  "providerStartedAt" TIMESTAMPTZ(3),
  "primaryProviderPeriodId" TEXT NOT NULL,
  "renewalOfPeriodId" TEXT,
  "endedEarlyAt" TIMESTAMPTZ(3),
  "endReason" "BillingPeriodEndReason",
  "replacedByPeriodId" TEXT,
  "providerEndedAt" TIMESTAMPTZ(3),
  "enforcedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_periods_dates_check" CHECK ("effectiveStart" < "effectiveEnd"),
  CONSTRAINT "billing_periods_capacity_check" CHECK ("capacityAtStart" > 0),
  CONSTRAINT "billing_periods_key_check" CHECK (btrim("materializationKey") <> '' AND btrim("logicalProductIdSnapshot") <> ''),
  CONSTRAINT "billing_periods_end_state_check" CHECK (
    ("endedEarlyAt" IS NULL AND "endReason" IS NULL AND "replacedByPeriodId" IS NULL)
    OR ("endedEarlyAt" > "effectiveStart" AND "endedEarlyAt" <= "effectiveEnd" AND "endReason" IS NOT NULL
      AND (("endReason" = 'SUPERSEDED' AND "replacedByPeriodId" IS NOT NULL)
        OR ("endReason" <> 'SUPERSEDED' AND "replacedByPeriodId" IS NULL)))
  )
);

CREATE TABLE "billing_period_sources" (
  "id" TEXT NOT NULL,
  "billingPeriodId" TEXT NOT NULL,
  "billingProviderPeriodId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_period_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_capacity_grants" (
  "id" TEXT NOT NULL,
  "billingPeriodId" TEXT NOT NULL,
  "billingTransactionId" TEXT NOT NULL,
  "previousCapacity" INTEGER NOT NULL,
  "newCapacity" INTEGER NOT NULL,
  "logicalProductIdSnapshot" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_capacity_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_capacity_grants_capacity_check" CHECK ("previousCapacity" > 0 AND "newCapacity" > "previousCapacity"),
  CONSTRAINT "billing_capacity_grants_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "billing_capacity_grants_product_check" CHECK (btrim("logicalProductIdSnapshot") <> '')
);

CREATE TABLE "division_capacity_assignments" (
  "id" TEXT NOT NULL,
  "billingPeriodId" TEXT NOT NULL,
  "slotNumber" INTEGER NOT NULL,
  "divisionId" TEXT,
  "divisionIdSnapshot" TEXT NOT NULL,
  "divisionNameSnapshot" TEXT NOT NULL,
  "leagueIdSnapshot" TEXT NOT NULL,
  "leagueNameSnapshot" TEXT NOT NULL,
  "ownerUserIdSnapshot" TEXT NOT NULL,
  "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignmentSource" "DivisionCapacityAssignmentSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "division_capacity_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "division_capacity_assignments_slot_check" CHECK ("slotNumber" >= 1),
  CONSTRAINT "division_capacity_assignments_snapshots_check" CHECK (
    btrim("divisionIdSnapshot") <> '' AND btrim("divisionNameSnapshot") <> ''
    AND btrim("leagueIdSnapshot") <> '' AND btrim("leagueNameSnapshot") <> ''
    AND btrim("ownerUserIdSnapshot") <> ''
  )
);

CREATE UNIQUE INDEX "billing_periods_account_materialization_key" ON "billing_periods"("billingAccountId", "materializationKey");
CREATE INDEX "billing_periods_account_window_idx" ON "billing_periods"("billingAccountId", "effectiveStart", "effectiveEnd");
CREATE INDEX "billing_periods_primary_provider_idx" ON "billing_periods"("primaryProviderPeriodId");
CREATE INDEX "billing_periods_renewal_idx" ON "billing_periods"("renewalOfPeriodId");
CREATE INDEX "billing_periods_replacement_idx" ON "billing_periods"("replacedByPeriodId");
CREATE UNIQUE INDEX "billing_period_sources_period_provider_key" ON "billing_period_sources"("billingPeriodId", "billingProviderPeriodId");
CREATE UNIQUE INDEX "billing_period_sources_one_primary_key" ON "billing_period_sources"("billingPeriodId") WHERE "isPrimary";
CREATE INDEX "billing_period_sources_provider_idx" ON "billing_period_sources"("billingProviderPeriodId");
CREATE UNIQUE INDEX "billing_capacity_grants_billingTransactionId_key" ON "billing_capacity_grants"("billingTransactionId");
CREATE UNIQUE INDEX "billing_capacity_grants_period_sequence_key" ON "billing_capacity_grants"("billingPeriodId", "sequence");
CREATE INDEX "billing_capacity_grants_effective_idx" ON "billing_capacity_grants"("billingPeriodId", "effectiveAt", "sequence", "id");
CREATE UNIQUE INDEX "division_capacity_assignments_period_slot_key" ON "division_capacity_assignments"("billingPeriodId", "slotNumber");
CREATE UNIQUE INDEX "division_capacity_assignments_period_division_key" ON "division_capacity_assignments"("billingPeriodId", "divisionIdSnapshot");
CREATE INDEX "division_capacity_assignments_division_idx" ON "division_capacity_assignments"("divisionId");
CREATE INDEX "division_capacity_assignments_snapshot_idx" ON "division_capacity_assignments"("divisionIdSnapshot", "assignedAt");
CREATE UNIQUE INDEX "free_grants_converted_period_key" ON "free_management_grants"("convertedToBillingPeriodId") WHERE "convertedToBillingPeriodId" IS NOT NULL;
CREATE UNIQUE INDEX "free_grants_converted_assignment_key" ON "free_management_grants"("convertedToAssignmentId") WHERE "convertedToAssignmentId" IS NOT NULL;

ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_account_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_primary_provider_fkey" FOREIGN KEY ("primaryProviderPeriodId") REFERENCES "billing_provider_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_renewal_fkey" FOREIGN KEY ("renewalOfPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_replacement_fkey" FOREIGN KEY ("replacedByPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "billing_period_sources" ADD CONSTRAINT "billing_period_sources_period_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_period_sources" ADD CONSTRAINT "billing_period_sources_provider_fkey" FOREIGN KEY ("billingProviderPeriodId") REFERENCES "billing_provider_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_capacity_grants" ADD CONSTRAINT "billing_capacity_grants_period_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_capacity_grants" ADD CONSTRAINT "billing_capacity_grants_transaction_fkey" FOREIGN KEY ("billingTransactionId") REFERENCES "billing_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "division_capacity_assignments" ADD CONSTRAINT "division_capacity_assignments_period_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "division_capacity_assignments" ADD CONSTRAINT "division_capacity_assignments_division_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_grants_converted_period_fkey" FOREIGN KEY ("convertedToBillingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_grants_converted_assignment_fkey" FOREIGN KEY ("convertedToAssignmentId") REFERENCES "division_capacity_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_no_overlap" EXCLUDE USING gist (
  "billingAccountId" WITH =,
  tstzrange("effectiveStart", COALESCE("endedEarlyAt", "effectiveEnd"), '[)') WITH &&
);

CREATE OR REPLACE FUNCTION enforce_billing_period_integrity()
RETURNS trigger AS $$
DECLARE
  primary_account TEXT;
  renewal_account TEXT;
  replacement_account TEXT;
BEGIN
  SELECT "billingAccountId" INTO primary_account FROM "billing_provider_periods" WHERE "id" = NEW."primaryProviderPeriodId";
  IF primary_account IS NULL OR primary_account <> NEW."billingAccountId" THEN
    RAISE EXCEPTION 'billing period primary evidence must belong to the same account';
  END IF;
  IF NEW."renewalOfPeriodId" IS NOT NULL THEN
    SELECT "billingAccountId" INTO renewal_account FROM "billing_periods" WHERE "id" = NEW."renewalOfPeriodId";
    IF renewal_account IS NULL OR renewal_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing period renewal must belong to the same account';
    END IF;
  END IF;
  IF NEW."replacedByPeriodId" IS NOT NULL THEN
    SELECT "billingAccountId" INTO replacement_account FROM "billing_periods" WHERE "id" = NEW."replacedByPeriodId";
    IF replacement_account IS NOT NULL AND replacement_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing period replacement must belong to the same account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_period_integrity_check"
BEFORE INSERT OR UPDATE ON "billing_periods"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_period_integrity();

CREATE OR REPLACE FUNCTION reject_invalid_billing_period_update()
RETURNS trigger AS $$
BEGIN
  IF OLD."endedEarlyAt" IS NOT NULL THEN
    RAISE EXCEPTION 'ended billing periods are immutable';
  END IF;
  IF ROW(OLD."billingAccountId", OLD."source", OLD."materializationKey", OLD."logicalProductIdSnapshot",
    OLD."capacityAtStart", OLD."billingIntervalAtStart", OLD."effectiveStart", OLD."effectiveEnd",
    OLD."providerStartedAt", OLD."primaryProviderPeriodId", OLD."renewalOfPeriodId", OLD."createdAt")
    IS DISTINCT FROM ROW(NEW."billingAccountId", NEW."source", NEW."materializationKey", NEW."logicalProductIdSnapshot",
    NEW."capacityAtStart", NEW."billingIntervalAtStart", NEW."effectiveStart", NEW."effectiveEnd",
    NEW."providerStartedAt", NEW."primaryProviderPeriodId", NEW."renewalOfPeriodId", NEW."createdAt") THEN
    RAISE EXCEPTION 'billing period identity and window are immutable';
  END IF;
  IF NEW."endedEarlyAt" IS NULL THEN
    RAISE EXCEPTION 'billing period updates may only end an active period';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_period_update_check"
BEFORE UPDATE ON "billing_periods"
FOR EACH ROW EXECUTE FUNCTION reject_invalid_billing_period_update();

CREATE OR REPLACE FUNCTION enforce_billing_period_source_integrity()
RETURNS trigger AS $$
DECLARE
  effective_account TEXT;
  provider_account TEXT;
BEGIN
  SELECT "billingAccountId" INTO effective_account FROM "billing_periods" WHERE "id" = NEW."billingPeriodId";
  SELECT "billingAccountId" INTO provider_account FROM "billing_provider_periods" WHERE "id" = NEW."billingProviderPeriodId";
  IF effective_account IS NULL OR provider_account IS NULL OR effective_account <> provider_account THEN
    RAISE EXCEPTION 'billing period source must belong to the same account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_period_source_integrity_check"
BEFORE INSERT OR UPDATE ON "billing_period_sources"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_period_source_integrity();

CREATE OR REPLACE FUNCTION enforce_billing_period_primary_source()
RETURNS trigger AS $$
DECLARE
  checked_period_id TEXT;
  expected_primary TEXT;
  primary_count INTEGER;
  checked_account TEXT;
  replacement_account TEXT;
  replacement_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'billing_periods' THEN
    checked_period_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    checked_period_id := OLD."billingPeriodId";
  ELSE
    checked_period_id := NEW."billingPeriodId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "billing_periods" WHERE "id" = checked_period_id) THEN RETURN NULL; END IF;
  SELECT "primaryProviderPeriodId", "billingAccountId", "replacedByPeriodId"
    INTO expected_primary, checked_account, replacement_id FROM "billing_periods" WHERE "id" = checked_period_id;
  SELECT COUNT(*) INTO primary_count FROM "billing_period_sources"
    WHERE "billingPeriodId" = checked_period_id AND "isPrimary" AND "billingProviderPeriodId" = expected_primary;
  IF primary_count <> 1 OR (SELECT COUNT(*) FROM "billing_period_sources" WHERE "billingPeriodId" = checked_period_id AND "isPrimary") <> 1 THEN
    RAISE EXCEPTION 'billing period must have exactly one matching primary source';
  END IF;
  IF replacement_id IS NOT NULL THEN
    SELECT "billingAccountId" INTO replacement_account FROM "billing_periods" WHERE "id" = replacement_id;
    IF replacement_account IS NULL OR replacement_account <> checked_account THEN
      RAISE EXCEPTION 'billing period replacement must belong to the same account';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE CONSTRAINT TRIGGER "billing_period_primary_source_check"
AFTER INSERT OR UPDATE ON "billing_periods" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_billing_period_primary_source();
CREATE CONSTRAINT TRIGGER "billing_period_source_primary_check"
AFTER INSERT OR UPDATE OR DELETE ON "billing_period_sources" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_billing_period_primary_source();

CREATE OR REPLACE FUNCTION enforce_billing_capacity_grant_integrity()
RETURNS trigger AS $$
DECLARE
  period_account TEXT;
  period_start TIMESTAMPTZ;
  period_end TIMESTAMPTZ;
  initial_capacity INTEGER;
  transaction_account TEXT;
  transaction_capacity INTEGER;
  transaction_product TEXT;
  expected_previous INTEGER;
  expected_sequence INTEGER;
BEGIN
  SELECT "billingAccountId", "effectiveStart", COALESCE("endedEarlyAt", "effectiveEnd"), "capacityAtStart"
    INTO period_account, period_start, period_end, initial_capacity FROM "billing_periods" WHERE "id" = NEW."billingPeriodId";
  SELECT "billingAccountId", "capacity", "logicalProductId"
    INTO transaction_account, transaction_capacity, transaction_product FROM "billing_transactions" WHERE "id" = NEW."billingTransactionId";
  IF period_account IS NULL OR transaction_account IS NULL OR period_account <> transaction_account
    OR transaction_capacity <> NEW."newCapacity" OR transaction_product <> NEW."logicalProductIdSnapshot" THEN
    RAISE EXCEPTION 'capacity grant must match its period account and transaction evidence';
  END IF;
  IF NEW."effectiveAt" < period_start OR NEW."effectiveAt" >= period_end THEN
    RAISE EXCEPTION 'capacity grant must be effective inside its billing period';
  END IF;
  SELECT COALESCE((SELECT "newCapacity" FROM "billing_capacity_grants"
    WHERE "billingPeriodId" = NEW."billingPeriodId"
    ORDER BY "effectiveAt" DESC, "sequence" DESC, "id" DESC LIMIT 1), initial_capacity),
    COALESCE((SELECT MAX("sequence") + 1 FROM "billing_capacity_grants" WHERE "billingPeriodId" = NEW."billingPeriodId"), 1)
    INTO expected_previous, expected_sequence;
  IF NEW."previousCapacity" <> expected_previous OR NEW."sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'capacity grant must continue the effective capacity sequence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_capacity_grant_integrity_check"
BEFORE INSERT ON "billing_capacity_grants"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_capacity_grant_integrity();

CREATE OR REPLACE FUNCTION reject_billing_effective_row_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'effective billing evidence is immutable';
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_capacity_grant_append_only" BEFORE UPDATE ON "billing_capacity_grants"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();
CREATE TRIGGER "billing_period_source_append_only" BEFORE UPDATE ON "billing_period_sources"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();
CREATE TRIGGER "division_capacity_assignment_append_only" BEFORE UPDATE ON "division_capacity_assignments"
FOR EACH ROW EXECUTE FUNCTION reject_billing_effective_row_update();

CREATE OR REPLACE FUNCTION enforce_division_capacity_assignment()
RETURNS trigger AS $$
DECLARE
  effective_capacity INTEGER;
  period_start TIMESTAMPTZ;
  period_end TIMESTAMPTZ;
BEGIN
  SELECT "capacityAtStart", "effectiveStart", COALESCE("endedEarlyAt", "effectiveEnd")
    INTO effective_capacity, period_start, period_end FROM "billing_periods" WHERE "id" = NEW."billingPeriodId";
  IF period_start IS NULL OR NEW."assignedAt" < period_start OR NEW."assignedAt" >= period_end THEN
    RAISE EXCEPTION 'division assignment must occur inside its billing period';
  END IF;
  SELECT COALESCE((SELECT "newCapacity" FROM "billing_capacity_grants"
    WHERE "billingPeriodId" = NEW."billingPeriodId" AND "effectiveAt" <= NEW."assignedAt"
    ORDER BY "effectiveAt" DESC, "sequence" DESC, "id" DESC LIMIT 1), effective_capacity)
    INTO effective_capacity;
  IF NEW."slotNumber" > effective_capacity THEN
    RAISE EXCEPTION 'division assignment exceeds effective billing capacity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "division_capacity_assignment_integrity_check"
BEFORE INSERT ON "division_capacity_assignments"
FOR EACH ROW EXECUTE FUNCTION enforce_division_capacity_assignment();

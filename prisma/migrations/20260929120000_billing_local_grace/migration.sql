CREATE TYPE "BillingLocalGraceStatus" AS ENUM ('ACTIVE', 'RECOVERED', 'EXPIRED', 'TERMINATED');
CREATE TYPE "BillingLocalGraceReason" AS ENUM ('BILLING_FAILURE');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_LOCAL_GRACE_STARTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_LOCAL_GRACE_RECOVERED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_LOCAL_GRACE_EXPIRED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_LOCAL_GRACE_TERMINATED';

CREATE TABLE "billing_local_graces" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "incidentKey" TEXT NOT NULL,
  "status" "BillingLocalGraceStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" "BillingLocalGraceReason" NOT NULL,
  "sourceBillingPeriodId" TEXT NOT NULL,
  "recoveryBillingPeriodId" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "recoveredAt" TIMESTAMPTZ(3),
  "expiredAt" TIMESTAMPTZ(3),
  "terminatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_local_graces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_local_graces_incident_key_check" CHECK (btrim("incidentKey") <> ''),
  CONSTRAINT "billing_local_graces_window_check" CHECK (
    "endsAt" >= "startedAt" AND "endsAt" <= "startedAt" + INTERVAL '30 days'
  ),
  CONSTRAINT "billing_local_graces_distinct_periods_check" CHECK (
    "recoveryBillingPeriodId" IS NULL OR "recoveryBillingPeriodId" <> "sourceBillingPeriodId"
  ),
  CONSTRAINT "billing_local_graces_state_check" CHECK (
    ("status" = 'ACTIVE' AND "recoveryBillingPeriodId" IS NULL AND "recoveredAt" IS NULL AND "expiredAt" IS NULL AND "terminatedAt" IS NULL)
    OR ("status" = 'RECOVERED' AND "recoveryBillingPeriodId" IS NOT NULL AND "recoveredAt" IS NOT NULL AND "recoveredAt" >= "startedAt" AND "recoveredAt" < "endsAt" AND "expiredAt" IS NULL AND "terminatedAt" IS NULL)
    OR ("status" = 'EXPIRED' AND "recoveryBillingPeriodId" IS NULL AND "recoveredAt" IS NULL AND "expiredAt" IS NOT NULL AND "expiredAt" >= "endsAt" AND "terminatedAt" IS NULL)
    OR ("status" = 'TERMINATED' AND "recoveryBillingPeriodId" IS NULL AND "recoveredAt" IS NULL AND "expiredAt" IS NULL AND "terminatedAt" IS NOT NULL AND "terminatedAt" >= "startedAt")
  )
);

CREATE UNIQUE INDEX "billing_local_graces_account_incident_key" ON "billing_local_graces"("billingAccountId", "incidentKey");
CREATE UNIQUE INDEX "billing_local_graces_source_period_key" ON "billing_local_graces"("sourceBillingPeriodId");
CREATE UNIQUE INDEX "billing_local_graces_recovery_period_key" ON "billing_local_graces"("recoveryBillingPeriodId") WHERE "recoveryBillingPeriodId" IS NOT NULL;
CREATE UNIQUE INDEX "billing_local_graces_active_account_key" ON "billing_local_graces"("billingAccountId") WHERE "status" = 'ACTIVE';
CREATE INDEX "billing_local_graces_account_status_idx" ON "billing_local_graces"("billingAccountId", "status");
CREATE INDEX "billing_local_graces_status_ends_idx" ON "billing_local_graces"("status", "endsAt");

ALTER TABLE "billing_local_graces" ADD CONSTRAINT "billing_local_graces_account_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_local_graces" ADD CONSTRAINT "billing_local_graces_source_period_fkey" FOREIGN KEY ("sourceBillingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_local_graces" ADD CONSTRAINT "billing_local_graces_recovery_period_fkey" FOREIGN KEY ("recoveryBillingPeriodId") REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "free_management_grants" ADD COLUMN "sourceLocalGraceId" TEXT;
CREATE UNIQUE INDEX "free_management_grants_source_local_grace_key" ON "free_management_grants"("sourceLocalGraceId");
ALTER TABLE "free_management_grants" ADD CONSTRAINT "free_management_grants_source_local_grace_fkey" FOREIGN KEY ("sourceLocalGraceId") REFERENCES "billing_local_graces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_billing_local_grace_membership() RETURNS trigger AS $$
DECLARE
  source_account TEXT;
  recovery_account TEXT;
BEGIN
  SELECT "billingAccountId" INTO source_account FROM "billing_periods" WHERE "id" = NEW."sourceBillingPeriodId";
  IF source_account IS NULL OR source_account <> NEW."billingAccountId" THEN
    RAISE EXCEPTION 'billing local grace source period must belong to the same account';
  END IF;
  IF NEW."recoveryBillingPeriodId" IS NOT NULL THEN
    SELECT "billingAccountId" INTO recovery_account FROM "billing_periods" WHERE "id" = NEW."recoveryBillingPeriodId";
    IF recovery_account IS NULL OR recovery_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing local grace recovery period must belong to the same account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_local_graces_membership" BEFORE INSERT OR UPDATE ON "billing_local_graces" FOR EACH ROW EXECUTE FUNCTION enforce_billing_local_grace_membership();

CREATE FUNCTION enforce_billing_local_grace_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing local grace incidents are durable evidence';
  END IF;
  IF ROW(NEW."id", NEW."billingAccountId", NEW."incidentKey", NEW."reason", NEW."sourceBillingPeriodId", NEW."startedAt", NEW."endsAt", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."id", OLD."billingAccountId", OLD."incidentKey", OLD."reason", OLD."sourceBillingPeriodId", OLD."startedAt", OLD."endsAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'billing local grace incident identity and window are immutable';
  END IF;
  IF OLD."status" <> 'ACTIVE' OR NEW."status" NOT IN ('RECOVERED', 'EXPIRED', 'TERMINATED') THEN
    RAISE EXCEPTION 'billing local grace transition is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_local_graces_guard" BEFORE UPDATE OR DELETE ON "billing_local_graces" FOR EACH ROW EXECUTE FUNCTION enforce_billing_local_grace_mutation();

CREATE FUNCTION enforce_free_management_grant_local_grace() RETURNS trigger AS $$
DECLARE
  grace_account TEXT;
  grace_status "BillingLocalGraceStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."sourceLocalGraceId" IS DISTINCT FROM OLD."sourceLocalGraceId" THEN
    RAISE EXCEPTION 'free management grant local grace provenance is immutable';
  END IF;
  IF NEW."sourceLocalGraceId" IS NULL THEN RETURN NEW; END IF;
  SELECT "billingAccountId", "status" INTO grace_account, grace_status FROM "billing_local_graces" WHERE "id" = NEW."sourceLocalGraceId";
  IF grace_account IS NULL OR NEW."billingAccountId" IS NULL OR grace_account <> NEW."billingAccountId" THEN
    RAISE EXCEPTION 'free management grant local grace must belong to the same account';
  END IF;
  IF grace_status NOT IN ('EXPIRED', 'TERMINATED') OR NEW."source" <> 'PAID_EXPIRATION' THEN
    RAISE EXCEPTION 'free management grant local grace provenance requires a closed incident';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "free_management_grants_local_grace_integrity" BEFORE INSERT OR UPDATE ON "free_management_grants" FOR EACH ROW EXECUTE FUNCTION enforce_free_management_grant_local_grace();

CREATE FUNCTION prevent_billing_local_grace_truncate() RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'billing local grace evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_local_graces_no_truncate" BEFORE TRUNCATE ON "billing_local_graces" FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_local_grace_truncate();

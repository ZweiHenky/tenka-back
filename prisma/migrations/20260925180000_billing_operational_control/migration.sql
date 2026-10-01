CREATE TYPE "BillingOperationalMode" AS ENUM ('ENABLED', 'PURCHASES_PAUSED');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_OPERATIONAL_CONTROL_VIEWED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_OPERATIONAL_CONTROL_CHANGED';

CREATE TABLE "billing_operational_controls" (
  "id" TEXT NOT NULL,
  "environment" "BillingEnvironment" NOT NULL,
  "mode" "BillingOperationalMode" NOT NULL DEFAULT 'PURCHASES_PAUSED',
  "reason" TEXT NOT NULL,
  "changedByAdminId" TEXT NOT NULL,
  "changedAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_operational_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_operational_controls_values_check" CHECK (
    char_length("reason") BETWEEN 10 AND 500
    AND char_length("changedByAdminId") BETWEEN 1 AND 255
    AND "version" >= 1
  )
);

CREATE UNIQUE INDEX "billing_operational_controls_environment_key"
  ON "billing_operational_controls"("environment");
CREATE UNIQUE INDEX "billing_operational_controls_environment_version_key"
  ON "billing_operational_controls"("environment", "version");

INSERT INTO "billing_operational_controls" (
  "id", "environment", "mode", "reason", "changedByAdminId", "changedAt", "updatedAt"
) VALUES
  ('billing_operational_control_preview', 'PREVIEW', 'PURCHASES_PAUSED',
    'Initial safe default: purchases paused', 'billing-system', NOW(), CURRENT_TIMESTAMP),
  ('billing_operational_control_production', 'PRODUCTION', 'PURCHASES_PAUSED',
    'Initial safe default: purchases paused', 'billing-system', NOW(), CURRENT_TIMESTAMP);

CREATE FUNCTION enforce_billing_operational_control_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing operational controls cannot be deleted';
  END IF;
  IF NEW."id" <> OLD."id"
    OR NEW."environment" <> OLD."environment"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing operational control identity is immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'billing operational control version must increase by one';
  END IF;
  IF NEW."changedAt" < OLD."changedAt" THEN
    RAISE EXCEPTION 'billing operational control changedAt cannot move backwards';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_operational_controls_guard"
BEFORE UPDATE OR DELETE ON "billing_operational_controls"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_operational_control_mutation();

CREATE FUNCTION prevent_billing_operational_control_truncate()
RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'billing operational controls cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_operational_controls_no_truncate"
BEFORE TRUNCATE ON "billing_operational_controls"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_operational_control_truncate();

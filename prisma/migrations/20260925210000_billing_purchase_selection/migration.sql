CREATE TYPE "BillingPurchaseSelectionStatus" AS ENUM ('DRAFT', 'LOCKED', 'APPLIED', 'SUPERSEDED');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PURCHASE_SELECTION_CREATED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PURCHASE_SELECTION_UPDATED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_PURCHASE_SELECTION_SUPERSEDED';

CREATE TABLE "billing_purchase_selections" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "logicalProductId" TEXT NOT NULL,
  "billingInterval" "BillingInterval" NOT NULL,
  "targetCapacity" INTEGER NOT NULL,
  "status" "BillingPurchaseSelectionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "lockedAt" TIMESTAMPTZ(3),
  "checkoutAttemptId" TEXT,
  "consumedByPeriodId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_purchase_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_purchase_selections_values_check" CHECK (
    "targetCapacity" >= 1
    AND "version" >= 1
    AND char_length("logicalProductId") BETWEEN 1 AND 100
    AND ("checkoutAttemptId" IS NULL OR char_length("checkoutAttemptId") BETWEEN 1 AND 255)
  ),
  CONSTRAINT "billing_purchase_selections_state_check" CHECK (
    ("status" = 'DRAFT' AND "lockedAt" IS NULL AND "checkoutAttemptId" IS NULL AND "consumedByPeriodId" IS NULL)
    OR ("status" = 'LOCKED' AND "lockedAt" IS NOT NULL AND "checkoutAttemptId" IS NOT NULL AND "consumedByPeriodId" IS NULL)
    OR ("status" = 'APPLIED' AND "lockedAt" IS NOT NULL AND "checkoutAttemptId" IS NOT NULL AND "consumedByPeriodId" IS NOT NULL)
    OR ("status" = 'SUPERSEDED' AND "consumedByPeriodId" IS NULL)
  ),
  CONSTRAINT "billing_purchase_selections_account_fkey" FOREIGN KEY ("billingAccountId")
    REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_purchase_selections_consumed_period_fkey" FOREIGN KEY ("consumedByPeriodId")
    REFERENCES "billing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "billing_purchase_selection_items" (
  "id" TEXT NOT NULL,
  "purchaseSelectionId" TEXT NOT NULL,
  "slotNumber" INTEGER NOT NULL,
  "divisionIdSnapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_purchase_selection_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_purchase_selection_items_slot_check" CHECK ("slotNumber" >= 1),
  CONSTRAINT "billing_purchase_selection_items_selection_fkey" FOREIGN KEY ("purchaseSelectionId")
    REFERENCES "billing_purchase_selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_purchase_selections_active_account_key"
  ON "billing_purchase_selections"("billingAccountId")
  WHERE "status" IN ('DRAFT', 'LOCKED');
CREATE UNIQUE INDEX "billing_purchase_selections_consumed_period_key"
  ON "billing_purchase_selections"("consumedByPeriodId")
  WHERE "consumedByPeriodId" IS NOT NULL;
CREATE INDEX "billing_purchase_selections_account_status_idx"
  ON "billing_purchase_selections"("billingAccountId", "status");
CREATE UNIQUE INDEX "billing_purchase_selection_items_selection_slot_key"
  ON "billing_purchase_selection_items"("purchaseSelectionId", "slotNumber");
CREATE UNIQUE INDEX "billing_purchase_selection_items_selection_division_key"
  ON "billing_purchase_selection_items"("purchaseSelectionId", "divisionIdSnapshot");
CREATE INDEX "billing_purchase_selection_items_division_idx"
  ON "billing_purchase_selection_items"("divisionIdSnapshot");

CREATE FUNCTION enforce_billing_purchase_selection_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing purchase selections cannot be deleted';
  END IF;
  IF NEW."id" <> OLD."id"
    OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."logicalProductId" <> OLD."logicalProductId"
    OR NEW."billingInterval" <> OLD."billingInterval"
    OR NEW."targetCapacity" <> OLD."targetCapacity"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing purchase selection identity and target are immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'billing purchase selection version must increase by one';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'LOCKED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid billing purchase selection transition';
  END IF;
  IF OLD."status" = 'LOCKED' AND NEW."status" NOT IN ('DRAFT', 'LOCKED', 'APPLIED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid billing purchase selection transition';
  END IF;
  IF OLD."status" IN ('APPLIED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'terminal billing purchase selection cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_purchase_selections_guard"
BEFORE UPDATE OR DELETE ON "billing_purchase_selections"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_purchase_selection_mutation();

CREATE FUNCTION enforce_billing_purchase_selection_item_mutation()
RETURNS trigger AS $$
DECLARE
  selection_status "BillingPurchaseSelectionStatus";
  selection_capacity INTEGER;
  selection_account TEXT;
  free_division_snapshot TEXT;
  target_selection_id TEXT;
BEGIN
  target_selection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."purchaseSelectionId" ELSE NEW."purchaseSelectionId" END;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" <> OLD."id"
    OR NEW."purchaseSelectionId" <> OLD."purchaseSelectionId"
    OR NEW."createdAt" <> OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'billing purchase selection item identity is immutable';
  END IF;
  SELECT "status", "targetCapacity", "billingAccountId"
  INTO selection_status, selection_capacity, selection_account
  FROM "billing_purchase_selections"
  WHERE "id" = target_selection_id;

  IF selection_status IS NULL OR selection_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'billing purchase selection items are editable only in DRAFT';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."slotNumber" > selection_capacity THEN
    RAISE EXCEPTION 'billing purchase selection slot exceeds target capacity';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."slotNumber" = 1 THEN
    SELECT "divisionIdSnapshot" INTO free_division_snapshot
    FROM "free_management_grants"
    WHERE "billingAccountId" = selection_account AND "endedAt" IS NULL;
    IF free_division_snapshot IS NOT NULL AND NEW."divisionIdSnapshot" <> free_division_snapshot THEN
      RAISE EXCEPTION 'billing purchase selection slot 1 is reserved for the free grant';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_purchase_selection_items_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "billing_purchase_selection_items"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_purchase_selection_item_mutation();

CREATE FUNCTION prevent_billing_purchase_selection_truncate()
RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'billing purchase selection history cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_purchase_selections_no_truncate"
BEFORE TRUNCATE ON "billing_purchase_selections"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_purchase_selection_truncate();

CREATE TRIGGER "billing_purchase_selection_items_no_truncate"
BEFORE TRUNCATE ON "billing_purchase_selection_items"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_purchase_selection_truncate();

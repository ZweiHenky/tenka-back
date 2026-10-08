CREATE TYPE "BillingChangeOperationType" AS ENUM ('GOOGLE_TWO_STEP');
CREATE TYPE "BillingChangeOperationStatus" AS ENUM (
  'DRAFT', 'FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING', 'FIRST_VERIFIED',
  'SECOND_STEP_PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'ABANDONED'
);
CREATE TYPE "BillingCheckoutAttemptPurpose" AS ENUM (
  'INITIAL_PURCHASE', 'PRODUCT_CHANGE_FIRST_STEP', 'PRODUCT_CHANGE_FINAL_STEP'
);

ALTER TABLE "billing_checkout_attempts"
  ALTER COLUMN "purchaseSelectionId" DROP NOT NULL,
  ADD COLUMN "changeOperationId" TEXT,
  ADD COLUMN "purpose" "BillingCheckoutAttemptPurpose" NOT NULL DEFAULT 'INITIAL_PURCHASE',
  ADD COLUMN "revenueCatProductIdentifierSnapshot" TEXT;

UPDATE "billing_checkout_attempts" a
SET "revenueCatProductIdentifierSnapshot" = p."revenueCatProductIdentifier"
FROM "billing_product_catalog" p
WHERE p."catalogReleaseId" = a."catalogReleaseIdSnapshot"
  AND p."store" = a."store"
  AND p."storeProductId" = a."storeProductIdSnapshot"
  AND p."basePlanId" IS NOT DISTINCT FROM a."basePlanIdSnapshot";

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CHANGE_OPERATION_CONFIRMED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CHANGE_OPERATION_ABANDONED';

CREATE TABLE "billing_change_operations" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "providerSubscriptionChainId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL DEFAULT 'GOOGLE',
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "abandonIdempotencyKey" TEXT,
  "abandonRequestFingerprint" TEXT,
  "type" "BillingChangeOperationType" NOT NULL,
  "status" "BillingChangeOperationStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceVariantId" TEXT NOT NULL,
  "intermediateVariantId" TEXT NOT NULL,
  "targetVariantId" TEXT NOT NULL,
  "firstVerificationId" TEXT,
  "secondVerificationId" TEXT,
  "scheduledAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_change_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_change_operations_values_check" CHECK (
    "version" >= 1
    AND char_length("idempotencyKey") BETWEEN 8 AND 128
    AND "idempotencyKey" = btrim("idempotencyKey")
    AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
    AND ("abandonIdempotencyKey" IS NULL OR (
      char_length("abandonIdempotencyKey") BETWEEN 8 AND 128
      AND "abandonIdempotencyKey" = btrim("abandonIdempotencyKey")
    ))
    AND ("abandonRequestFingerprint" IS NULL OR "abandonRequestFingerprint" ~ '^[0-9a-f]{64}$')
    AND (("abandonIdempotencyKey" IS NULL) = ("abandonRequestFingerprint" IS NULL))
    AND "store" = 'GOOGLE'
    AND "type" = 'GOOGLE_TWO_STEP'
  ),
  CONSTRAINT "billing_change_operations_state_check" CHECK (
    (
      "status" IN ('DRAFT', 'FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING', 'CANCELED')
      AND "firstVerificationId" IS NULL
      AND "secondVerificationId" IS NULL
      AND "abandonIdempotencyKey" IS NULL
      AND "scheduledAt" IS NULL
      AND "completedAt" IS NULL
    ) OR (
      "status" IN ('FIRST_VERIFIED', 'SECOND_STEP_PENDING', 'ABANDONED')
      AND "firstVerificationId" IS NOT NULL
      AND "secondVerificationId" IS NULL
      AND (("status" = 'ABANDONED') = ("abandonIdempotencyKey" IS NOT NULL))
      AND "scheduledAt" IS NULL
      AND "completedAt" IS NULL
    ) OR (
      "status" = 'SCHEDULED'
      AND "firstVerificationId" IS NOT NULL
      AND "secondVerificationId" IS NOT NULL
      AND "abandonIdempotencyKey" IS NULL
      AND "scheduledAt" IS NOT NULL
      AND "completedAt" IS NULL
    ) OR (
      "status" = 'COMPLETED'
      AND "firstVerificationId" IS NOT NULL
      AND "secondVerificationId" IS NOT NULL
      AND "abandonIdempotencyKey" IS NULL
      AND "scheduledAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "billing_change_operations_account_fkey" FOREIGN KEY ("billingAccountId")
    REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_chain_fkey" FOREIGN KEY ("providerSubscriptionChainId")
    REFERENCES "billing_provider_subscription_chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_first_verification_fkey" FOREIGN KEY ("firstVerificationId")
    REFERENCES "billing_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_second_verification_fkey" FOREIGN KEY ("secondVerificationId")
    REFERENCES "billing_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_source_variant_fkey" FOREIGN KEY ("sourceVariantId")
    REFERENCES "billing_product_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_intermediate_variant_fkey" FOREIGN KEY ("intermediateVariantId")
    REFERENCES "billing_product_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_change_operations_target_variant_fkey" FOREIGN KEY ("targetVariantId")
    REFERENCES "billing_product_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_change_operation_fkey" FOREIGN KEY ("changeOperationId")
    REFERENCES "billing_change_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_change_operations_account_idempotency_key"
  ON "billing_change_operations"("billingAccountId", "idempotencyKey");
CREATE UNIQUE INDEX "billing_change_operations_account_abandon_idempotency_key"
  ON "billing_change_operations"("billingAccountId", "abandonIdempotencyKey");
CREATE UNIQUE INDEX "billing_change_operations_active_account_key"
  ON "billing_change_operations"("billingAccountId")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELED', 'ABANDONED');
CREATE UNIQUE INDEX "billing_change_operations_first_verification_key"
  ON "billing_change_operations"("firstVerificationId");
CREATE UNIQUE INDEX "billing_change_operations_second_verification_key"
  ON "billing_change_operations"("secondVerificationId");
CREATE INDEX "billing_change_operations_billingAccountId_status_idx"
  ON "billing_change_operations"("billingAccountId", "status");
CREATE INDEX "billing_change_operations_providerSubscriptionChainId_status_idx"
  ON "billing_change_operations"("providerSubscriptionChainId", "status");

DROP INDEX "billing_checkout_attempts_active_account_key";
DROP INDEX "billing_checkout_attempts_active_selection_key";
CREATE UNIQUE INDEX "billing_checkout_attempts_active_initial_account_key"
  ON "billing_checkout_attempts"("billingAccountId")
  WHERE "purpose" = 'INITIAL_PURCHASE'
    AND "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED');
CREATE UNIQUE INDEX "billing_checkout_attempts_active_selection_key"
  ON "billing_checkout_attempts"("purchaseSelectionId")
  WHERE "purpose" = 'INITIAL_PURCHASE'
    AND "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED');
CREATE UNIQUE INDEX "billing_checkout_attempts_active_operation_purpose_key"
  ON "billing_checkout_attempts"("changeOperationId", "purpose")
  WHERE "purpose" IN ('PRODUCT_CHANGE_FIRST_STEP', 'PRODUCT_CHANGE_FINAL_STEP')
    AND "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED');
CREATE INDEX "billing_checkout_attempts_operation_purpose_created_idx"
  ON "billing_checkout_attempts"("changeOperationId", "purpose", "createdAt");

CREATE OR REPLACE FUNCTION enforce_billing_checkout_attempt_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing checkout attempts cannot be deleted'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."purchaseSelectionId" IS DISTINCT FROM OLD."purchaseSelectionId"
    OR NEW."changeOperationId" IS DISTINCT FROM OLD."changeOperationId"
    OR NEW."purpose" <> OLD."purpose" OR NEW."store" <> OLD."store"
    OR NEW."catalogReleaseIdSnapshot" <> OLD."catalogReleaseIdSnapshot"
    OR NEW."logicalProductIdSnapshot" <> OLD."logicalProductIdSnapshot"
    OR NEW."billingIntervalSnapshot" <> OLD."billingIntervalSnapshot"
    OR NEW."targetCapacitySnapshot" <> OLD."targetCapacitySnapshot"
    OR NEW."offeringIdSnapshot" <> OLD."offeringIdSnapshot"
    OR NEW."packageIdSnapshot" <> OLD."packageIdSnapshot"
    OR NEW."storeProductIdSnapshot" <> OLD."storeProductIdSnapshot"
    OR NEW."basePlanIdSnapshot" IS DISTINCT FROM OLD."basePlanIdSnapshot"
    OR NEW."revenueCatProductIdentifierSnapshot" IS DISTINCT FROM OLD."revenueCatProductIdentifierSnapshot"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."requestFingerprint" <> OLD."requestFingerprint"
    OR NEW."startedAt" <> OLD."startedAt" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing checkout attempt identity and target are immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'billing checkout attempt version must increase by one';
  END IF;
  IF OLD."status" IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED') THEN
    RAISE EXCEPTION 'terminal billing checkout attempt cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_billing_checkout_membership()
RETURNS trigger AS $$
DECLARE
  selection_account TEXT;
  operation_account TEXT;
  operation_created TIMESTAMP(3);
  expected_release TEXT;
  expected_logical_product TEXT;
  expected_interval "BillingInterval";
  expected_capacity INTEGER;
  expected_offering TEXT;
  expected_package TEXT;
  expected_store_product TEXT;
  expected_base_plan TEXT;
  expected_revenuecat_product TEXT;
BEGIN
  IF NEW."purpose" = 'INITIAL_PURCHASE' THEN
    IF NEW."purchaseSelectionId" IS NULL OR NEW."changeOperationId" IS NOT NULL THEN
      RAISE EXCEPTION 'initial checkout attempt requires only a purchase selection';
    END IF;
    SELECT "billingAccountId" INTO selection_account FROM "billing_purchase_selections"
      WHERE "id" = NEW."purchaseSelectionId";
    IF selection_account IS NULL OR selection_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing checkout attempt must belong to selection account';
    END IF;
  ELSE
    IF NEW."purchaseSelectionId" IS NOT NULL OR NEW."changeOperationId" IS NULL OR NEW."store" <> 'GOOGLE' THEN
      RAISE EXCEPTION 'product change checkout attempt requires only a Google change operation';
    END IF;
    SELECT o."billingAccountId", o."createdAt", p."catalogReleaseId", p."logicalProductId", p."billingInterval",
      p."capacity", p."revenueCatOfferingId", p."revenueCatPackageId", p."storeProductId", p."basePlanId",
      p."revenueCatProductIdentifier"
    INTO operation_account, operation_created, expected_release, expected_logical_product, expected_interval,
      expected_capacity, expected_offering, expected_package, expected_store_product, expected_base_plan,
      expected_revenuecat_product
    FROM "billing_change_operations" o
    JOIN "billing_product_catalog" p ON p."id" = CASE
      WHEN NEW."purpose" = 'PRODUCT_CHANGE_FIRST_STEP' THEN o."intermediateVariantId"
      ELSE o."targetVariantId"
    END
    WHERE o."id" = NEW."changeOperationId";
    IF operation_account IS NULL OR operation_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing checkout attempt must belong to change operation account';
    END IF;
    IF NEW."startedAt" < operation_created THEN
      RAISE EXCEPTION 'billing checkout attempt cannot predate its change operation';
    END IF;
    IF NEW."catalogReleaseIdSnapshot" <> expected_release
      OR NEW."logicalProductIdSnapshot" <> expected_logical_product
      OR NEW."billingIntervalSnapshot" <> expected_interval
      OR NEW."targetCapacitySnapshot" <> expected_capacity
      OR NEW."offeringIdSnapshot" <> expected_offering
      OR NEW."packageIdSnapshot" <> expected_package
      OR NEW."storeProductIdSnapshot" <> expected_store_product
      OR NEW."basePlanIdSnapshot" IS DISTINCT FROM expected_base_plan
      OR NEW."revenueCatProductIdentifierSnapshot" IS DISTINCT FROM expected_revenuecat_product THEN
      RAISE EXCEPTION 'billing checkout attempt target must match its change operation step';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE FUNCTION enforce_billing_change_operation_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing change operations cannot be deleted'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."providerSubscriptionChainId" <> OLD."providerSubscriptionChainId"
    OR NEW."store" <> OLD."store" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."requestFingerprint" <> OLD."requestFingerprint" OR NEW."type" <> OLD."type"
    OR NEW."sourceVariantId" <> OLD."sourceVariantId"
    OR NEW."intermediateVariantId" <> OLD."intermediateVariantId"
    OR NEW."targetVariantId" <> OLD."targetVariantId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing change operation identity and target are immutable';
  END IF;
  IF NEW."abandonIdempotencyKey" IS DISTINCT FROM OLD."abandonIdempotencyKey"
    OR NEW."abandonRequestFingerprint" IS DISTINCT FROM OLD."abandonRequestFingerprint" THEN
    IF NOT (
      OLD."abandonIdempotencyKey" IS NULL
      AND OLD."abandonRequestFingerprint" IS NULL
      AND NEW."abandonIdempotencyKey" IS NOT NULL
      AND NEW."abandonRequestFingerprint" IS NOT NULL
      AND OLD."status" = 'SECOND_STEP_PENDING'
      AND NEW."status" = 'ABANDONED'
    ) THEN
      RAISE EXCEPTION 'billing change operation abandon identity is immutable';
    END IF;
  END IF;
  IF OLD."status" = 'SECOND_STEP_PENDING' AND NEW."status" = 'ABANDONED'
    AND EXISTS (
      SELECT 1 FROM "billing_checkout_attempts"
      WHERE "changeOperationId" = OLD."id"
        AND "purpose" = 'PRODUCT_CHANGE_FINAL_STEP'
        AND "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED')
    ) THEN
    RAISE EXCEPTION 'billing change operation with an active final attempt cannot be abandoned';
  END IF;
  IF NEW."firstVerificationId" IS DISTINCT FROM OLD."firstVerificationId"
    AND NOT (
      OLD."firstVerificationId" IS NULL
      AND NEW."firstVerificationId" IS NOT NULL
      AND OLD."status" = 'FIRST_VERIFICATION_PENDING'
      AND NEW."status" = 'FIRST_VERIFIED'
    ) THEN
    RAISE EXCEPTION 'billing change operation first verification is immutable';
  END IF;
  IF NEW."secondVerificationId" IS DISTINCT FROM OLD."secondVerificationId"
    AND NOT (
      OLD."secondVerificationId" IS NULL
      AND NEW."secondVerificationId" IS NOT NULL
      AND OLD."status" = 'SECOND_STEP_PENDING'
      AND NEW."status" = 'SCHEDULED'
    ) THEN
    RAISE EXCEPTION 'billing change operation second verification is immutable';
  END IF;
  IF NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt"
    AND NOT (
      OLD."scheduledAt" IS NULL
      AND NEW."scheduledAt" IS NOT NULL
      AND OLD."status" = 'SECOND_STEP_PENDING'
      AND NEW."status" = 'SCHEDULED'
    ) THEN
    RAISE EXCEPTION 'billing change operation scheduled timestamp is immutable';
  END IF;
  IF NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    AND NOT (
      OLD."completedAt" IS NULL
      AND NEW."completedAt" IS NOT NULL
      AND OLD."status" = 'SCHEDULED'
      AND NEW."status" = 'COMPLETED'
    ) THEN
    RAISE EXCEPTION 'billing change operation completed timestamp is immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'billing change operation version must increase by one';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'FIRST_PURCHASE_PENDING') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  ELSIF OLD."status" = 'FIRST_PURCHASE_PENDING'
    AND NEW."status" NOT IN ('FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING', 'CANCELED') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  ELSIF OLD."status" = 'FIRST_VERIFICATION_PENDING'
    AND NEW."status" NOT IN ('FIRST_VERIFICATION_PENDING', 'FIRST_VERIFIED') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  ELSIF OLD."status" = 'FIRST_VERIFIED'
    AND NEW."status" NOT IN ('FIRST_VERIFIED', 'SECOND_STEP_PENDING') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  ELSIF OLD."status" = 'SECOND_STEP_PENDING'
    AND NEW."status" NOT IN ('SECOND_STEP_PENDING', 'SCHEDULED', 'ABANDONED') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  ELSIF OLD."status" = 'SCHEDULED' AND NEW."status" NOT IN ('SCHEDULED', 'COMPLETED') THEN
    RAISE EXCEPTION 'invalid billing change operation transition';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELED', 'ABANDONED') THEN
    RAISE EXCEPTION 'terminal billing change operation cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_change_operations_guard"
BEFORE UPDATE OR DELETE ON "billing_change_operations"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_change_operation_mutation();

CREATE FUNCTION enforce_billing_change_operation_membership()
RETURNS trigger AS $$
DECLARE
  chain_account TEXT;
  chain_store "BillingStore";
  verification_account TEXT;
  verification_store "BillingStore";
  verification_chain TEXT;
  verification_status "BillingVerificationStatus";
  verification_operation TEXT;
  verification_purpose "BillingCheckoutAttemptPurpose";
  second_verification_account TEXT;
  second_verification_store "BillingStore";
  second_verification_chain TEXT;
  second_verification_status "BillingVerificationStatus";
  second_verification_operation TEXT;
  second_verification_purpose "BillingCheckoutAttemptPurpose";
  source_release TEXT;
  source_store "BillingStore";
  source_interval "BillingInterval";
  source_capacity INTEGER;
  intermediate_release TEXT;
  intermediate_store "BillingStore";
  intermediate_product TEXT;
  intermediate_interval "BillingInterval";
  intermediate_capacity INTEGER;
  target_release TEXT;
  target_store "BillingStore";
  target_product TEXT;
  target_interval "BillingInterval";
  target_capacity INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
  SELECT "billingAccountId", "store" INTO chain_account, chain_store FROM "billing_provider_subscription_chains"
  WHERE "id" = NEW."providerSubscriptionChainId";
  IF chain_account IS NULL OR chain_account <> NEW."billingAccountId" OR chain_store <> NEW."store" THEN
    RAISE EXCEPTION 'billing change operation chain must match account and store';
  END IF;
  SELECT "catalogReleaseId", "store", "billingInterval", "capacity"
    INTO source_release, source_store, source_interval, source_capacity
  FROM "billing_product_catalog" WHERE "id" = NEW."sourceVariantId";
  SELECT "catalogReleaseId", "store", "logicalProductId", "billingInterval", "capacity"
    INTO intermediate_release, intermediate_store, intermediate_product, intermediate_interval, intermediate_capacity
  FROM "billing_product_catalog" WHERE "id" = NEW."intermediateVariantId";
  SELECT "catalogReleaseId", "store", "logicalProductId", "billingInterval", "capacity"
    INTO target_release, target_store, target_product, target_interval, target_capacity
  FROM "billing_product_catalog" WHERE "id" = NEW."targetVariantId";
  IF source_release IS NULL OR intermediate_release IS NULL OR target_release IS NULL
    OR source_release <> intermediate_release OR source_release <> target_release
    OR source_store <> 'GOOGLE' OR intermediate_store <> 'GOOGLE' OR target_store <> 'GOOGLE'
    OR intermediate_interval <> source_interval
    OR target_interval = source_interval
    OR intermediate_product <> target_product
    OR intermediate_capacity <> target_capacity
    OR target_capacity <= source_capacity THEN
    RAISE EXCEPTION 'billing change operation variants must form a coherent Google two-step upgrade';
  END IF;
  IF NEW."firstVerificationId" IS NOT NULL THEN
    SELECT "billingAccountId", "store", "providerSubscriptionChainId", "status"
      INTO verification_account, verification_store, verification_chain, verification_status
    FROM "billing_verifications" WHERE "id" = NEW."firstVerificationId";
    SELECT a."changeOperationId", a."purpose" INTO verification_operation, verification_purpose
    FROM "billing_verifications" v JOIN "billing_checkout_attempts" a ON a."id" = v."checkoutAttemptId"
    WHERE v."id" = NEW."firstVerificationId";
    IF verification_account IS NULL
      OR verification_account <> NEW."billingAccountId"
      OR verification_store <> NEW."store"
      OR verification_chain IS DISTINCT FROM NEW."providerSubscriptionChainId"
      OR verification_status <> 'VERIFIED'
      OR verification_operation IS DISTINCT FROM NEW."id"
      OR verification_purpose <> 'PRODUCT_CHANGE_FIRST_STEP' THEN
      RAISE EXCEPTION 'billing change operation verification must be verified evidence for its account, store, and chain';
    END IF;
  END IF;
  IF NEW."secondVerificationId" IS NOT NULL THEN
    SELECT "billingAccountId", "store", "providerSubscriptionChainId", "status"
      INTO second_verification_account, second_verification_store, second_verification_chain, second_verification_status
    FROM "billing_verifications" WHERE "id" = NEW."secondVerificationId";
    SELECT a."changeOperationId", a."purpose" INTO second_verification_operation, second_verification_purpose
    FROM "billing_verifications" v JOIN "billing_checkout_attempts" a ON a."id" = v."checkoutAttemptId"
    WHERE v."id" = NEW."secondVerificationId";
    IF second_verification_account IS NULL
      OR second_verification_account <> NEW."billingAccountId"
      OR second_verification_store <> NEW."store"
      OR second_verification_chain IS DISTINCT FROM NEW."providerSubscriptionChainId"
      OR second_verification_status <> 'VERIFIED'
      OR second_verification_operation IS DISTINCT FROM NEW."id"
      OR second_verification_purpose <> 'PRODUCT_CHANGE_FINAL_STEP' THEN
      RAISE EXCEPTION 'billing change operation second verification must be verified evidence for its account, store, and chain';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_change_operations_membership"
BEFORE INSERT OR UPDATE ON "billing_change_operations"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_change_operation_membership();

CREATE FUNCTION prevent_billing_change_operation_truncate()
RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'billing change operation history cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_change_operations_no_truncate"
BEFORE TRUNCATE ON "billing_change_operations"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_change_operation_truncate();

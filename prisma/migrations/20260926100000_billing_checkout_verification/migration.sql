CREATE TYPE "BillingCheckoutAttemptStatus" AS ENUM (
  'PREPARED', 'STORE_PENDING', 'VERIFICATION_PENDING', 'CANCEL_REPORTED', 'VERIFYING',
  'VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'
);
CREATE TYPE "BillingVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'OWNERSHIP_CONFLICT', 'REJECTED');

ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CHECKOUT_ATTEMPT_STARTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CHECKOUT_OUTCOME_REPORTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_CHECKOUT_ATTEMPT_COMPLETED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_VERIFICATION_REQUESTED';
ALTER TYPE "BillingAuditAction" ADD VALUE 'BILLING_VERIFICATION_COMPLETED';

CREATE TABLE "billing_checkout_attempts" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "purchaseSelectionId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL,
  "catalogReleaseIdSnapshot" TEXT NOT NULL,
  "logicalProductIdSnapshot" TEXT NOT NULL,
  "billingIntervalSnapshot" "BillingInterval" NOT NULL,
  "targetCapacitySnapshot" INTEGER NOT NULL,
  "offeringIdSnapshot" TEXT NOT NULL,
  "packageIdSnapshot" TEXT NOT NULL,
  "storeProductIdSnapshot" TEXT NOT NULL,
  "basePlanIdSnapshot" TEXT,
  "status" "BillingCheckoutAttemptStatus" NOT NULL DEFAULT 'PREPARED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "sdkOutcomeAt" TIMESTAMPTZ(3),
  "nextVerificationAt" TIMESTAMPTZ(3),
  "lastVerificationAt" TIMESTAMPTZ(3),
  "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMPTZ(3),
  "lockedBy" TEXT,
  "terminalAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_checkout_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_checkout_attempts_values_check" CHECK (
    "targetCapacitySnapshot" BETWEEN 2 AND 15
    AND "version" >= 1
    AND "verificationAttempts" >= 0
    AND char_length("idempotencyKey") BETWEEN 8 AND 128
    AND char_length("requestFingerprint") = 64
  ),
  CONSTRAINT "billing_checkout_attempts_terminal_check" CHECK (
    ("status" IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED') AND "terminalAt" IS NOT NULL)
    OR ("status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED') AND "terminalAt" IS NULL)
  ),
  CONSTRAINT "billing_checkout_attempts_lease_check" CHECK (
    ("leaseUntil" IS NULL AND "lockedBy" IS NULL) OR ("leaseUntil" IS NOT NULL AND "lockedBy" IS NOT NULL)
  ),
  CONSTRAINT "billing_checkout_attempts_account_fkey" FOREIGN KEY ("billingAccountId")
    REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_checkout_attempts_selection_fkey" FOREIGN KEY ("purchaseSelectionId")
    REFERENCES "billing_purchase_selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "billing_verifications" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "checkoutAttemptId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "providerSubscriptionChainId" TEXT,
  "providerTransactionId" TEXT,
  "status" "BillingVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastAttemptAt" TIMESTAMPTZ(3),
  "verifiedAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_verifications_values_check" CHECK (
    "attemptCount" >= 0
    AND char_length("idempotencyKey") BETWEEN 8 AND 128
    AND char_length("requestFingerprint") = 64
  ),
  CONSTRAINT "billing_verifications_state_check" CHECK (
    ("status" = 'PENDING' AND "verifiedAt" IS NULL)
    OR ("status" = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "providerSubscriptionChainId" IS NOT NULL)
    OR ("status" IN ('OWNERSHIP_CONFLICT', 'REJECTED') AND "verifiedAt" IS NULL)
  ),
  CONSTRAINT "billing_verifications_account_fkey" FOREIGN KEY ("billingAccountId")
    REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_verifications_checkout_attempt_fkey" FOREIGN KEY ("checkoutAttemptId")
    REFERENCES "billing_checkout_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_verifications_chain_fkey" FOREIGN KEY ("providerSubscriptionChainId")
    REFERENCES "billing_provider_subscription_chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_checkout_attempts_account_idempotency_key"
  ON "billing_checkout_attempts"("billingAccountId", "idempotencyKey");
CREATE UNIQUE INDEX "billing_checkout_attempts_active_account_key"
  ON "billing_checkout_attempts"("billingAccountId")
  WHERE "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED');
CREATE UNIQUE INDEX "billing_checkout_attempts_active_selection_key"
  ON "billing_checkout_attempts"("purchaseSelectionId")
  WHERE "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED');
CREATE INDEX "billing_checkout_attempts_due_idx"
  ON "billing_checkout_attempts"("status", "nextVerificationAt", "leaseUntil");
CREATE INDEX "billing_checkout_attempts_selection_created_idx"
  ON "billing_checkout_attempts"("purchaseSelectionId", "createdAt");
CREATE UNIQUE INDEX "billing_verifications_checkout_attempt_key"
  ON "billing_verifications"("checkoutAttemptId");
CREATE UNIQUE INDEX "billing_verifications_account_idempotency_key"
  ON "billing_verifications"("billingAccountId", "idempotencyKey");
CREATE INDEX "billing_verifications_status_requested_idx"
  ON "billing_verifications"("status", "requestedAt");
CREATE INDEX "billing_verifications_chain_idx"
  ON "billing_verifications"("providerSubscriptionChainId");

CREATE UNIQUE INDEX "billing_purchase_selections_checkout_attempt_key"
  ON "billing_purchase_selections"("checkoutAttemptId") WHERE "checkoutAttemptId" IS NOT NULL;
ALTER TABLE "billing_purchase_selections"
  ADD CONSTRAINT "billing_purchase_selections_checkout_attempt_fkey"
  FOREIGN KEY ("checkoutAttemptId") REFERENCES "billing_checkout_attempts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_billing_checkout_attempt_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing checkout attempts cannot be deleted'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."purchaseSelectionId" <> OLD."purchaseSelectionId" OR NEW."store" <> OLD."store"
    OR NEW."catalogReleaseIdSnapshot" <> OLD."catalogReleaseIdSnapshot"
    OR NEW."logicalProductIdSnapshot" <> OLD."logicalProductIdSnapshot"
    OR NEW."billingIntervalSnapshot" <> OLD."billingIntervalSnapshot"
    OR NEW."targetCapacitySnapshot" <> OLD."targetCapacitySnapshot"
    OR NEW."offeringIdSnapshot" <> OLD."offeringIdSnapshot"
    OR NEW."packageIdSnapshot" <> OLD."packageIdSnapshot"
    OR NEW."storeProductIdSnapshot" <> OLD."storeProductIdSnapshot"
    OR NEW."basePlanIdSnapshot" IS DISTINCT FROM OLD."basePlanIdSnapshot"
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

CREATE TRIGGER "billing_checkout_attempts_guard"
BEFORE UPDATE OR DELETE ON "billing_checkout_attempts"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_checkout_attempt_mutation();

CREATE FUNCTION enforce_billing_verification_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing verifications cannot be deleted'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."checkoutAttemptId" <> OLD."checkoutAttemptId" OR NEW."store" <> OLD."store"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."requestFingerprint" <> OLD."requestFingerprint"
    OR NEW."requestedAt" <> OLD."requestedAt" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'billing verification identity is immutable';
  END IF;
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'terminal billing verification cannot be changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_verifications_guard"
BEFORE UPDATE OR DELETE ON "billing_verifications"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_verification_mutation();

CREATE FUNCTION enforce_billing_checkout_membership()
RETURNS trigger AS $$
DECLARE selection_account TEXT; attempt_account TEXT; attempt_selection TEXT;
BEGIN
  SELECT "billingAccountId" INTO selection_account
  FROM "billing_purchase_selections" WHERE "id" = NEW."purchaseSelectionId";
  IF selection_account IS NULL OR selection_account <> NEW."billingAccountId" THEN
    RAISE EXCEPTION 'billing checkout attempt must belong to selection account';
  END IF;
  IF TG_TABLE_NAME = 'billing_verifications' THEN
    SELECT "billingAccountId", "purchaseSelectionId" INTO attempt_account, attempt_selection
    FROM "billing_checkout_attempts" WHERE "id" = NEW."checkoutAttemptId";
    IF attempt_account IS NULL OR attempt_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing verification must belong to checkout account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_checkout_attempts_membership"
BEFORE INSERT OR UPDATE ON "billing_checkout_attempts"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_checkout_membership();

CREATE FUNCTION enforce_billing_verification_membership()
RETURNS trigger AS $$
DECLARE attempt_account TEXT; attempt_store "BillingStore"; chain_account TEXT;
BEGIN
  SELECT "billingAccountId", "store" INTO attempt_account, attempt_store
  FROM "billing_checkout_attempts" WHERE "id" = NEW."checkoutAttemptId";
  IF attempt_account IS NULL OR attempt_account <> NEW."billingAccountId" OR attempt_store <> NEW."store" THEN
    RAISE EXCEPTION 'billing verification must match checkout account and store';
  END IF;
  IF NEW."providerSubscriptionChainId" IS NOT NULL THEN
    SELECT "billingAccountId" INTO chain_account FROM "billing_provider_subscription_chains"
    WHERE "id" = NEW."providerSubscriptionChainId";
    IF chain_account IS NULL OR chain_account <> NEW."billingAccountId" THEN
      RAISE EXCEPTION 'billing verification chain must belong to account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_verifications_membership"
BEFORE INSERT OR UPDATE ON "billing_verifications"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_verification_membership();

CREATE OR REPLACE FUNCTION enforce_billing_purchase_selection_mutation()
RETURNS trigger AS $$
DECLARE attempt_account TEXT; attempt_selection TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'billing purchase selections cannot be deleted'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."billingAccountId" <> OLD."billingAccountId"
    OR NEW."logicalProductId" <> OLD."logicalProductId"
    OR NEW."billingInterval" <> OLD."billingInterval"
    OR NEW."targetCapacity" <> OLD."targetCapacity" OR NEW."createdAt" <> OLD."createdAt" THEN
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
  IF NEW."checkoutAttemptId" IS NOT NULL THEN
    SELECT "billingAccountId", "purchaseSelectionId" INTO attempt_account, attempt_selection
    FROM "billing_checkout_attempts" WHERE "id" = NEW."checkoutAttemptId";
    IF attempt_account IS NULL OR attempt_account <> NEW."billingAccountId" OR attempt_selection <> NEW."id" THEN
      RAISE EXCEPTION 'billing purchase selection checkout attempt mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE FUNCTION prevent_billing_checkout_truncate()
RETURNS trigger AS $$
BEGIN
  IF current_schema() = 'tenka_integration' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'billing checkout history cannot be truncated';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "billing_checkout_attempts_no_truncate" BEFORE TRUNCATE ON "billing_checkout_attempts"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_checkout_truncate();
CREATE TRIGGER "billing_verifications_no_truncate" BEFORE TRUNCATE ON "billing_verifications"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_checkout_truncate();

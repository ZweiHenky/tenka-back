-- Canonical provider evidence only. This migration does not materialize paid access or enable purchases.
CREATE TYPE "BillingStoreEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
CREATE TYPE "BillingProviderStatus" AS ENUM ('ACTIVE', 'BILLING_RETRY', 'STORE_GRACE', 'ACCOUNT_HOLD', 'PAUSED', 'EXPIRED', 'REVOKED', 'UNKNOWN');
CREATE TYPE "BillingProviderEndReason" AS ENUM ('VOLUNTARY', 'BILLING_FAILURE', 'PAUSE', 'REFUND', 'REVOCATION', 'CHARGEBACK', 'FRAUD', 'UNKNOWN');
CREATE TYPE "BillingOwnershipType" AS ENUM ('PURCHASED', 'FAMILY_SHARED', 'UNKNOWN');
CREATE TYPE "BillingTransactionEventType" AS ENUM ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'RECOVERY', 'UNKNOWN');

CREATE TABLE "billing_provider_subscription_chains" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL,
  "providerChainReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_provider_subscription_chains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_provider_subscription_chains_reference_check" CHECK (btrim("providerChainReference") <> '')
);

CREATE TABLE "billing_provider_subscriptions" (
  "id" TEXT NOT NULL,
  "providerSubscriptionChainId" TEXT NOT NULL,
  "store" "BillingStore" NOT NULL,
  "storeEnvironment" "BillingStoreEnvironment" NOT NULL,
  "providerSubscriptionKey" TEXT NOT NULL,
  "replacesProviderSubscriptionId" TEXT,
  "providerStatus" "BillingProviderStatus" NOT NULL,
  "providerStatusUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "entitlementActive" BOOLEAN NOT NULL,
  "providerEndReason" "BillingProviderEndReason",
  "canonicalEvidenceReference" TEXT,
  "providerAccessEndsAt" TIMESTAMPTZ(3),
  "providerEventId" TEXT,
  "willRenew" BOOLEAN,
  "canceledAt" TIMESTAMPTZ(3),
  "currentLogicalProductId" TEXT,
  "currentStoreProductId" TEXT,
  "currentBasePlanId" TEXT,
  "currentCapacity" INTEGER,
  "currentBillingInterval" "BillingInterval",
  "pendingLogicalProductId" TEXT,
  "pendingStoreProductId" TEXT,
  "pendingBasePlanId" TEXT,
  "pendingCapacity" INTEGER,
  "pendingBillingInterval" "BillingInterval",
  "pendingEffectiveAt" TIMESTAMPTZ(3),
  "ownershipType" "BillingOwnershipType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_provider_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_provider_subscriptions_key_check" CHECK (btrim("providerSubscriptionKey") <> ''),
  CONSTRAINT "billing_provider_subscriptions_current_capacity_check" CHECK ("currentCapacity" IS NULL OR "currentCapacity" BETWEEN 2 AND 15),
  CONSTRAINT "billing_provider_subscriptions_pending_capacity_check" CHECK ("pendingCapacity" IS NULL OR "pendingCapacity" BETWEEN 2 AND 15),
  CONSTRAINT "billing_provider_subscriptions_current_product_check" CHECK (
    ("currentLogicalProductId" IS NULL AND "currentStoreProductId" IS NULL AND "currentBasePlanId" IS NULL AND "currentCapacity" IS NULL AND "currentBillingInterval" IS NULL)
    OR ("currentLogicalProductId" IS NOT NULL AND "currentStoreProductId" IS NOT NULL AND "currentCapacity" IS NOT NULL AND "currentBillingInterval" IS NOT NULL
      AND (("store" = 'GOOGLE' AND "currentBasePlanId" IS NOT NULL) OR ("store" = 'APPLE' AND "currentBasePlanId" IS NULL)))
  ),
  CONSTRAINT "billing_provider_subscriptions_pending_product_check" CHECK (
    ("pendingLogicalProductId" IS NULL AND "pendingStoreProductId" IS NULL AND "pendingBasePlanId" IS NULL AND "pendingCapacity" IS NULL AND "pendingBillingInterval" IS NULL AND "pendingEffectiveAt" IS NULL)
    OR ("pendingLogicalProductId" IS NOT NULL AND "pendingStoreProductId" IS NOT NULL AND "pendingCapacity" IS NOT NULL AND "pendingBillingInterval" IS NOT NULL AND "pendingEffectiveAt" IS NOT NULL
      AND (("store" = 'GOOGLE' AND "pendingBasePlanId" IS NOT NULL) OR ("store" = 'APPLE' AND "pendingBasePlanId" IS NULL)))
  ),
  CONSTRAINT "billing_provider_subscriptions_not_self_replacing_check" CHECK ("replacesProviderSubscriptionId" IS NULL OR "replacesProviderSubscriptionId" <> "id")
);

CREATE TABLE "billing_transactions" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "providerSubscriptionId" TEXT,
  "store" "BillingStore" NOT NULL,
  "storeEnvironment" "BillingStoreEnvironment" NOT NULL,
  "providerTransactionId" TEXT NOT NULL,
  "eventType" "BillingTransactionEventType" NOT NULL,
  "logicalProductId" TEXT NOT NULL,
  "storeProductId" TEXT NOT NULL,
  "basePlanId" TEXT,
  "capacity" INTEGER NOT NULL,
  "billingInterval" "BillingInterval" NOT NULL,
  "purchasedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_transactions_ids_check" CHECK (btrim("providerTransactionId") <> '' AND btrim("logicalProductId") <> '' AND btrim("storeProductId") <> ''),
  CONSTRAINT "billing_transactions_capacity_check" CHECK ("capacity" BETWEEN 2 AND 15),
  CONSTRAINT "billing_transactions_store_plan_check" CHECK (("store" = 'GOOGLE' AND "basePlanId" IS NOT NULL) OR ("store" = 'APPLE' AND "basePlanId" IS NULL))
);

CREATE TABLE "billing_provider_periods" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "providerSubscriptionId" TEXT NOT NULL,
  "billingTransactionId" TEXT,
  "store" "BillingStore" NOT NULL,
  "storeEnvironment" "BillingStoreEnvironment" NOT NULL,
  "providerPeriodKey" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedesProviderPeriodId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "logicalProductId" TEXT NOT NULL,
  "storeProductId" TEXT NOT NULL,
  "basePlanId" TEXT,
  "capacity" INTEGER NOT NULL,
  "billingInterval" "BillingInterval" NOT NULL,
  "providerPeriodStart" TIMESTAMPTZ(3) NOT NULL,
  "providerPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
  "providerStatus" "BillingProviderStatus" NOT NULL,
  "entitlementActive" BOOLEAN NOT NULL,
  "providerEndReason" "BillingProviderEndReason",
  "canonicalEvidenceReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_provider_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_provider_periods_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "billing_provider_periods_dates_check" CHECK ("providerPeriodStart" < "providerPeriodEnd"),
  CONSTRAINT "billing_provider_periods_capacity_check" CHECK ("capacity" BETWEEN 2 AND 15),
  CONSTRAINT "billing_provider_periods_ids_check" CHECK (btrim("dedupeKey") <> '' AND btrim("logicalProductId") <> '' AND btrim("storeProductId") <> ''),
  CONSTRAINT "billing_provider_periods_store_plan_check" CHECK (("store" = 'GOOGLE' AND "basePlanId" IS NOT NULL) OR ("store" = 'APPLE' AND "basePlanId" IS NULL)),
  CONSTRAINT "billing_provider_periods_not_self_superseding_check" CHECK ("supersedesProviderPeriodId" IS NULL OR "supersedesProviderPeriodId" <> "id")
);

CREATE UNIQUE INDEX "billing_provider_subscription_chains_store_providerChainReference_key" ON "billing_provider_subscription_chains"("store", "providerChainReference");
CREATE INDEX "billing_provider_subscription_chains_billingAccountId_store_idx" ON "billing_provider_subscription_chains"("billingAccountId", "store");
CREATE UNIQUE INDEX "billing_provider_subscriptions_store_providerSubscriptionKey_key" ON "billing_provider_subscriptions"("store", "providerSubscriptionKey");
CREATE INDEX "billing_provider_subscriptions_providerSubscriptionChainId_idx" ON "billing_provider_subscriptions"("providerSubscriptionChainId");
CREATE INDEX "billing_provider_subscriptions_replacesProviderSubscriptionId_idx" ON "billing_provider_subscriptions"("replacesProviderSubscriptionId");
CREATE UNIQUE INDEX "billing_transactions_store_providerTransactionId_key" ON "billing_transactions"("store", "providerTransactionId");
CREATE INDEX "billing_transactions_billingAccountId_purchasedAt_idx" ON "billing_transactions"("billingAccountId", "purchasedAt");
CREATE INDEX "billing_transactions_providerSubscriptionId_idx" ON "billing_transactions"("providerSubscriptionId");
CREATE UNIQUE INDEX "billing_provider_periods_providerSubscriptionId_dedupeKey_key" ON "billing_provider_periods"("providerSubscriptionId", "dedupeKey");
CREATE UNIQUE INDEX "billing_provider_periods_providerSubscriptionId_providerPeriodKey_revision_key" ON "billing_provider_periods"("providerSubscriptionId", "providerPeriodKey", "revision");
CREATE INDEX "billing_provider_periods_billingAccountId_providerPeriodEnd_idx" ON "billing_provider_periods"("billingAccountId", "providerPeriodEnd");
CREATE INDEX "billing_provider_periods_billingTransactionId_idx" ON "billing_provider_periods"("billingTransactionId");
CREATE INDEX "billing_provider_periods_supersedesProviderPeriodId_idx" ON "billing_provider_periods"("supersedesProviderPeriodId");

ALTER TABLE "billing_provider_subscription_chains" ADD CONSTRAINT "billing_provider_subscription_chains_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_subscriptions" ADD CONSTRAINT "billing_provider_subscriptions_providerSubscriptionChainId_fkey" FOREIGN KEY ("providerSubscriptionChainId") REFERENCES "billing_provider_subscription_chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_subscriptions" ADD CONSTRAINT "billing_provider_subscriptions_replacesProviderSubscriptionId_fkey" FOREIGN KEY ("replacesProviderSubscriptionId") REFERENCES "billing_provider_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_providerSubscriptionId_fkey" FOREIGN KEY ("providerSubscriptionId") REFERENCES "billing_provider_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_periods" ADD CONSTRAINT "billing_provider_periods_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_periods" ADD CONSTRAINT "billing_provider_periods_providerSubscriptionId_fkey" FOREIGN KEY ("providerSubscriptionId") REFERENCES "billing_provider_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_periods" ADD CONSTRAINT "billing_provider_periods_billingTransactionId_fkey" FOREIGN KEY ("billingTransactionId") REFERENCES "billing_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_provider_periods" ADD CONSTRAINT "billing_provider_periods_supersedesProviderPeriodId_fkey" FOREIGN KEY ("supersedesProviderPeriodId") REFERENCES "billing_provider_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_billing_provider_subscription_integrity()
RETURNS trigger AS $$
DECLARE
  chain_store "BillingStore";
  replacement_chain TEXT;
BEGIN
  SELECT "store" INTO chain_store FROM "billing_provider_subscription_chains" WHERE "id" = NEW."providerSubscriptionChainId";
  IF chain_store IS NULL OR chain_store <> NEW."store" THEN
    RAISE EXCEPTION 'provider subscription must use its chain store';
  END IF;
  IF NEW."replacesProviderSubscriptionId" IS NOT NULL THEN
    SELECT "providerSubscriptionChainId" INTO replacement_chain FROM "billing_provider_subscriptions" WHERE "id" = NEW."replacesProviderSubscriptionId";
    IF replacement_chain IS NULL OR replacement_chain <> NEW."providerSubscriptionChainId" THEN
      RAISE EXCEPTION 'replacement subscription must belong to the same chain';
    END IF;
    IF EXISTS (
      WITH RECURSIVE replacement_path("id") AS (
        SELECT NEW."replacesProviderSubscriptionId"
        UNION
        SELECT subscription."replacesProviderSubscriptionId"
        FROM "billing_provider_subscriptions" subscription
        JOIN replacement_path path ON subscription."id" = path."id"
        WHERE subscription."replacesProviderSubscriptionId" IS NOT NULL
      )
      SELECT 1 FROM replacement_path WHERE "id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'provider subscription replacement cycle is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_provider_subscription_integrity_check"
BEFORE INSERT OR UPDATE ON "billing_provider_subscriptions"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_provider_subscription_integrity();

CREATE OR REPLACE FUNCTION enforce_billing_transaction_integrity()
RETURNS trigger AS $$
DECLARE
  subscription_account TEXT;
  subscription_store "BillingStore";
  subscription_environment "BillingStoreEnvironment";
BEGIN
  IF NEW."providerSubscriptionId" IS NULL THEN RETURN NEW; END IF;
  SELECT chain."billingAccountId", subscription."store", subscription."storeEnvironment"
  INTO subscription_account, subscription_store, subscription_environment
  FROM "billing_provider_subscriptions" subscription
  JOIN "billing_provider_subscription_chains" chain ON chain."id" = subscription."providerSubscriptionChainId"
  WHERE subscription."id" = NEW."providerSubscriptionId";
  IF subscription_account IS NULL OR subscription_account <> NEW."billingAccountId"
    OR subscription_store <> NEW."store" OR subscription_environment <> NEW."storeEnvironment" THEN
    RAISE EXCEPTION 'billing transaction must match its subscription account, store, and environment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_transaction_integrity_check"
BEFORE INSERT OR UPDATE ON "billing_transactions"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_transaction_integrity();

CREATE OR REPLACE FUNCTION enforce_billing_provider_period_integrity()
RETURNS trigger AS $$
DECLARE
  subscription_account TEXT;
  subscription_store "BillingStore";
  subscription_environment "BillingStoreEnvironment";
  transaction_account TEXT;
  transaction_subscription TEXT;
  transaction_store "BillingStore";
  transaction_environment "BillingStoreEnvironment";
  previous_subscription TEXT;
  previous_key TEXT;
  previous_revision INTEGER;
BEGIN
  SELECT chain."billingAccountId", subscription."store", subscription."storeEnvironment"
  INTO subscription_account, subscription_store, subscription_environment
  FROM "billing_provider_subscriptions" subscription
  JOIN "billing_provider_subscription_chains" chain ON chain."id" = subscription."providerSubscriptionChainId"
  WHERE subscription."id" = NEW."providerSubscriptionId";
  IF subscription_account IS NULL OR subscription_account <> NEW."billingAccountId"
    OR subscription_store <> NEW."store" OR subscription_environment <> NEW."storeEnvironment" THEN
    RAISE EXCEPTION 'provider period must match its subscription account, store, and environment';
  END IF;

  IF NEW."billingTransactionId" IS NOT NULL THEN
    SELECT "billingAccountId", "providerSubscriptionId", "store", "storeEnvironment"
    INTO transaction_account, transaction_subscription, transaction_store, transaction_environment
    FROM "billing_transactions" WHERE "id" = NEW."billingTransactionId";
    IF transaction_account IS NULL OR transaction_account <> NEW."billingAccountId"
      OR transaction_subscription IS DISTINCT FROM NEW."providerSubscriptionId"
      OR transaction_store <> NEW."store" OR transaction_environment <> NEW."storeEnvironment" THEN
      RAISE EXCEPTION 'provider period must match its transaction account, subscription, store, and environment';
    END IF;
  END IF;

  IF NEW."supersedesProviderPeriodId" IS NULL THEN
    IF NEW."revision" <> 1 THEN RAISE EXCEPTION 'initial provider period revision must be one'; END IF;
  ELSE
    SELECT "providerSubscriptionId", "providerPeriodKey", "revision"
    INTO previous_subscription, previous_key, previous_revision
    FROM "billing_provider_periods" WHERE "id" = NEW."supersedesProviderPeriodId";
    IF previous_subscription IS NULL OR previous_subscription <> NEW."providerSubscriptionId"
      OR previous_key IS DISTINCT FROM NEW."providerPeriodKey" OR NEW."revision" <> previous_revision + 1 THEN
      RAISE EXCEPTION 'provider period revision must consecutively supersede the same canonical period';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_provider_period_integrity_check"
BEFORE INSERT ON "billing_provider_periods"
FOR EACH ROW EXECUTE FUNCTION enforce_billing_provider_period_integrity();

CREATE OR REPLACE FUNCTION reject_billing_provider_period_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing provider periods are append-only';
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

CREATE TRIGGER "billing_provider_period_append_only"
BEFORE UPDATE ON "billing_provider_periods"
FOR EACH ROW EXECUTE FUNCTION reject_billing_provider_period_update();

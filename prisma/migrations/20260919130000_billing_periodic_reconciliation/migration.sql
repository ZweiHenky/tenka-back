CREATE TYPE "BillingReconciliationJobStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'RETRY');

CREATE TABLE "billing_revenuecat_reconciliations" (
  "billingAccountId" TEXT NOT NULL,
  "status" "BillingReconciliationJobStatus" NOT NULL DEFAULT 'SCHEDULED',
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestedNextAttemptAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "lockedBy" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSucceededAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastIssueSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_revenuecat_reconciliations_pkey" PRIMARY KEY ("billingAccountId"),
  CONSTRAINT "billing_revenuecat_reconciliations_failures_check" CHECK ("consecutiveFailures" >= 0),
  CONSTRAINT "billing_revenuecat_reconciliations_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "leaseUntil" IS NOT NULL AND "lockedBy" IS NOT NULL)
    OR ("status" <> 'PROCESSING' AND "leaseUntil" IS NULL AND "lockedBy" IS NULL)
  ),
  CONSTRAINT "billing_revenuecat_reconciliations_requested_check" CHECK (
    "requestedNextAttemptAt" IS NULL OR "status" = 'PROCESSING'
  ),
  CONSTRAINT "billing_revenuecat_reconciliations_error_check" CHECK (
    "lastErrorCode" IS NULL OR char_length("lastErrorCode") BETWEEN 1 AND 100
  )
);

ALTER TABLE "billing_revenuecat_reconciliations"
  ADD CONSTRAINT "billing_revenuecat_reconciliations_account_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "billing_revenuecat_reconciliations_status_due_lease_idx"
  ON "billing_revenuecat_reconciliations"("status", "nextAttemptAt", "leaseUntil");

-- Only accounts with existing commercial evidence enter the periodic queue.
INSERT INTO "billing_revenuecat_reconciliations" ("billingAccountId", "nextAttemptAt")
SELECT account.id, NOW() + random() * INTERVAL '2 hours'
FROM "billing_accounts" account
WHERE EXISTS (
  SELECT 1
  FROM "billing_provider_subscription_chains" chain
  WHERE chain."billingAccountId" = account.id
);

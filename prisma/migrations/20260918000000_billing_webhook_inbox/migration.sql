CREATE TYPE "BillingWebhookEventStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'RETRY',
  'QUARANTINED',
  'PROCESSED',
  'DEAD_LETTER',
  'CONFLICT'
);

CREATE TABLE "billing_webhook_events" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadRedacted" JSONB,
  "payloadHash" TEXT NOT NULL,
  "status" "BillingWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "payloadPurgedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_webhook_events_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 12),
  CONSTRAINT "billing_webhook_events_payload_hash_check" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "billing_webhook_events_identity_length_check" CHECK (
    char_length("providerEventId") BETWEEN 1 AND 255
    AND char_length("eventType") BETWEEN 1 AND 100
  ),
  CONSTRAINT "billing_webhook_events_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "leaseUntil" IS NOT NULL AND "lockedBy" IS NOT NULL)
    OR ("status" <> 'PROCESSING' AND "leaseUntil" IS NULL AND "lockedBy" IS NULL)
  ),
  CONSTRAINT "billing_webhook_events_processed_check" CHECK (
    ("status" = 'PROCESSED' AND "processedAt" IS NOT NULL)
    OR ("status" <> 'PROCESSED')
  ),
  CONSTRAINT "billing_webhook_events_purge_check" CHECK (
    ("payloadPurgedAt" IS NULL)
    OR ("payloadRedacted" IS NULL)
  )
);

CREATE TABLE "billing_webhook_observations" (
  "id" TEXT NOT NULL,
  "billingWebhookEventId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payloadRedacted" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadPurgedAt" TIMESTAMP(3),
  "conflictReason" TEXT NOT NULL,

  CONSTRAINT "billing_webhook_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_webhook_observations_payload_hash_check" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "billing_webhook_observations_conflict_reason_check" CHECK (
    char_length("conflictReason") BETWEEN 1 AND 100
  ),
  CONSTRAINT "billing_webhook_observations_purge_check" CHECK (
    ("payloadPurgedAt" IS NULL)
    OR ("payloadRedacted" IS NULL)
  )
);

CREATE UNIQUE INDEX "billing_webhook_events_providerEventId_key"
  ON "billing_webhook_events"("providerEventId");
CREATE INDEX "billing_webhook_events_status_nextAttemptAt_leaseUntil_idx"
  ON "billing_webhook_events"("status", "nextAttemptAt", "leaseUntil");
CREATE UNIQUE INDEX "billing_webhook_observations_event_hash_key"
  ON "billing_webhook_observations"("billingWebhookEventId", "payloadHash");
CREATE INDEX "billing_webhook_observations_receivedAt_idx"
  ON "billing_webhook_observations"("receivedAt");

ALTER TABLE "billing_webhook_observations"
  ADD CONSTRAINT "billing_webhook_observations_event_fkey"
  FOREIGN KEY ("billingWebhookEventId") REFERENCES "billing_webhook_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_billing_webhook_evidence_rewrite()
RETURNS trigger AS $$
BEGIN
  IF NEW."providerEventId" <> OLD."providerEventId"
    OR NEW."eventType" <> OLD."eventType"
    OR NEW."payloadHash" <> OLD."payloadHash"
    OR NEW."receivedAt" <> OLD."receivedAt" THEN
    RAISE EXCEPTION 'billing webhook evidence is immutable';
  END IF;
  IF NEW."payloadRedacted" IS DISTINCT FROM OLD."payloadRedacted"
    AND NOT (
      OLD."payloadRedacted" IS NOT NULL
      AND NEW."payloadRedacted" IS NULL
      AND OLD."payloadPurgedAt" IS NULL
      AND NEW."payloadPurgedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'billing webhook payload is immutable except for retention purge';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_webhook_events_evidence_immutable"
BEFORE UPDATE ON "billing_webhook_events"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_webhook_evidence_rewrite();

CREATE FUNCTION prevent_billing_webhook_observation_rewrite()
RETURNS trigger AS $$
BEGIN
  IF NEW."billingWebhookEventId" <> OLD."billingWebhookEventId"
    OR NEW."payloadHash" <> OLD."payloadHash"
    OR NEW."receivedAt" <> OLD."receivedAt"
    OR NEW."conflictReason" <> OLD."conflictReason" THEN
    RAISE EXCEPTION 'billing webhook observation is immutable';
  END IF;
  IF NEW."payloadRedacted" IS DISTINCT FROM OLD."payloadRedacted"
    AND NOT (
      OLD."payloadRedacted" IS NOT NULL
      AND NEW."payloadRedacted" IS NULL
      AND OLD."payloadPurgedAt" IS NULL
      AND NEW."payloadPurgedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'billing webhook observation payload is immutable except for retention purge';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_webhook_observations_evidence_immutable"
BEFORE UPDATE ON "billing_webhook_observations"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_webhook_observation_rewrite();

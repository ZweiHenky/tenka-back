CREATE TYPE "BillingAuditAction" AS ENUM (
  'WEBHOOK_QUEUE_VIEWED',
  'WEBHOOK_EVENT_VIEWED',
  'WEBHOOK_REPLAY_REQUESTED'
);

CREATE TYPE "BillingAuditActorType" AS ENUM ('USER', 'SYSTEM', 'PROVIDER');

ALTER TABLE "billing_webhook_events"
  ADD COLUMN "quarantineStartedAt" TIMESTAMP(3),
  ADD COLUMN "replayCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReplayAt" TIMESTAMP(3);

UPDATE "billing_webhook_events"
SET "quarantineStartedAt" = "updatedAt"
WHERE status = 'QUARANTINED';

UPDATE "billing_webhook_events"
SET "processedAt" = NULL
WHERE status <> 'PROCESSED' AND "processedAt" IS NOT NULL;

ALTER TABLE "billing_webhook_events"
  DROP CONSTRAINT "billing_webhook_events_processed_check",
  ADD CONSTRAINT "billing_webhook_events_processed_check" CHECK (
    (status = 'PROCESSED') = ("processedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "billing_webhook_events_quarantine_check" CHECK (
    status <> 'QUARANTINED' OR "quarantineStartedAt" IS NOT NULL
  ),
  ADD CONSTRAINT "billing_webhook_events_replay_check" CHECK (
    ("replayCount" = 0 AND "lastReplayAt" IS NULL)
    OR ("replayCount" > 0 AND "lastReplayAt" IS NOT NULL)
  );

CREATE TABLE "billing_audit_logs" (
  "id" TEXT NOT NULL,
  "action" "BillingAuditAction" NOT NULL,
  "actorType" "BillingAuditActorType" NOT NULL,
  "actorUserId" TEXT,
  "actorUserIdSnapshot" TEXT NOT NULL,
  "billingWebhookEventId" TEXT,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "metadataRedacted" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_audit_logs_lengths_check" CHECK (
    char_length("actorUserIdSnapshot") BETWEEN 1 AND 255
    AND char_length("targetType") BETWEEN 1 AND 100
    AND char_length("targetId") BETWEEN 1 AND 255
    AND char_length("requestId") BETWEEN 1 AND 128
    AND ("reason" IS NULL OR char_length("reason") BETWEEN 10 AND 500)
    AND ("idempotencyKey" IS NULL OR char_length("idempotencyKey") BETWEEN 8 AND 128)
    AND ("requestFingerprint" IS NULL OR "requestFingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "billing_audit_logs_actor_check" CHECK (
    ("actorType" = 'USER' AND "actorUserId" IS NOT NULL)
    OR ("actorType" <> 'USER' AND "actorUserId" IS NULL)
  ),
  CONSTRAINT "billing_audit_logs_replay_check" CHECK (
    "action" <> 'WEBHOOK_REPLAY_REQUESTED'
    OR (
      "billingWebhookEventId" IS NOT NULL
      AND "reason" IS NOT NULL
      AND "idempotencyKey" IS NOT NULL
      AND "requestFingerprint" IS NOT NULL
    )
  )
);

CREATE INDEX "billing_audit_logs_webhook_event_created_idx"
  ON "billing_audit_logs"("billingWebhookEventId", "createdAt");
CREATE INDEX "billing_audit_logs_actor_created_idx"
  ON "billing_audit_logs"("actorUserIdSnapshot", "createdAt");
CREATE INDEX "billing_audit_logs_action_created_idx"
  ON "billing_audit_logs"("action", "createdAt");
CREATE UNIQUE INDEX "billing_audit_logs_idempotency_key"
  ON "billing_audit_logs"("actorUserIdSnapshot", "action", "targetType", "targetId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE FUNCTION prevent_billing_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "billing_audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_audit_log_mutation();

CREATE TRIGGER "billing_audit_logs_no_truncate"
BEFORE TRUNCATE ON "billing_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_audit_log_mutation();

CREATE OR REPLACE FUNCTION prevent_billing_webhook_evidence_rewrite()
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
  IF NEW."payloadPurgedAt" IS DISTINCT FROM OLD."payloadPurgedAt"
    AND NOT (
      OLD."payloadRedacted" IS NOT NULL
      AND NEW."payloadRedacted" IS NULL
      AND OLD."payloadPurgedAt" IS NULL
      AND NEW."payloadPurgedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'billing webhook purge evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_billing_webhook_observation_rewrite()
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
  IF NEW."payloadPurgedAt" IS DISTINCT FROM OLD."payloadPurgedAt"
    AND NOT (
      OLD."payloadRedacted" IS NOT NULL
      AND NEW."payloadRedacted" IS NULL
      AND OLD."payloadPurgedAt" IS NULL
      AND NEW."payloadPurgedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'billing webhook observation purge evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION prevent_billing_webhook_evidence_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing webhook evidence cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "billing_webhook_events_no_delete"
BEFORE DELETE ON "billing_webhook_events"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_webhook_evidence_delete();

CREATE TRIGGER "billing_webhook_observations_no_delete"
BEFORE DELETE ON "billing_webhook_observations"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_webhook_evidence_delete();

CREATE TRIGGER "billing_webhook_events_no_truncate"
BEFORE TRUNCATE ON "billing_webhook_events"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_webhook_evidence_delete();

CREATE TRIGGER "billing_webhook_observations_no_truncate"
BEFORE TRUNCATE ON "billing_webhook_observations"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_billing_webhook_evidence_delete();

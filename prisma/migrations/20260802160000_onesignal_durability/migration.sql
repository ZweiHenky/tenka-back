CREATE TYPE "NotificationAudience" AS ENUM ('REGISTERED', 'FOLLOWERS');
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD', 'CANCELLED');
CREATE TYPE "OneSignalTagSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'DEAD');

ALTER TABLE division_notification_subscriptions ADD COLUMN "userId" TEXT;
ALTER TABLE division_notification_subscriptions
  ADD CONSTRAINT "division_notification_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "division_notification_subscriptions_divisionId_userId_idx" ON division_notification_subscriptions("divisionId", "userId");
CREATE INDEX "division_notification_subscriptions_pushSubscriptionId_idx" ON division_notification_subscriptions("pushSubscriptionId");
-- A device may have been recorded under more than one OneSignal user identity.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "divisionId", "pushSubscriptionId"
    ORDER BY "updatedAt" DESC, id
  ) AS rn
  FROM division_notification_subscriptions
  WHERE "pushSubscriptionId" IS NOT NULL
)
DELETE FROM division_notification_subscriptions subscription
USING ranked
WHERE subscription.id = ranked.id AND ranked.rn > 1;
CREATE UNIQUE INDEX "division_notification_subscriptions_divisionId_pushSubscriptionId_key"
  ON division_notification_subscriptions("divisionId", "pushSubscriptionId");

ALTER TABLE onesignal_tag_cleanup_jobs
  ADD COLUMN desired BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN status "OneSignalTagSyncStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "deadAt" TIMESTAMP(3);
DROP INDEX IF EXISTS "onesignal_tag_cleanup_jobs_nextTryAt_idx";
CREATE INDEX "onesignal_tag_cleanup_jobs_status_nextTryAt_leaseUntil_idx"
  ON onesignal_tag_cleanup_jobs(status, "nextTryAt", "leaseUntil");

CREATE TABLE notification_outbox (
  id TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "jornadaId" TEXT,
  "divisionId" TEXT NOT NULL,
  audience "NotificationAudience" NOT NULL,
  "providerIdempotencyKey" TEXT NOT NULL,
  status "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT notification_outbox_jornadaId_fkey FOREIGN KEY ("jornadaId") REFERENCES jornadas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT notification_outbox_divisionId_fkey FOREIGN KEY ("divisionId") REFERENCES divisiones(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_outbox_eventKey_key" ON notification_outbox("eventKey");
CREATE UNIQUE INDEX "notification_outbox_providerIdempotencyKey_key" ON notification_outbox("providerIdempotencyKey");
CREATE INDEX "notification_outbox_status_nextAttemptAt_leaseUntil_idx" ON notification_outbox(status, "nextAttemptAt", "leaseUntil");
CREATE INDEX "notification_outbox_jornadaId_idx" ON notification_outbox("jornadaId");
CREATE INDEX "notification_outbox_divisionId_audience_idx" ON notification_outbox("divisionId", audience);

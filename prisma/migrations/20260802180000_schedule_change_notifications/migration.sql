CREATE TYPE "NotificationEventType" AS ENUM ('JORNADA_GENERATED', 'SCHEDULE_CHANGED');

ALTER TABLE notification_outbox
  ADD COLUMN "eventType" "NotificationEventType" NOT NULL DEFAULT 'JORNADA_GENERATED',
  ADD COLUMN "aggregationKey" TEXT,
  ADD COLUMN payload JSONB,
  ADD COLUMN "targetUserIds" JSONB;

CREATE UNIQUE INDEX "notification_outbox_aggregationKey_key"
  ON notification_outbox("aggregationKey");

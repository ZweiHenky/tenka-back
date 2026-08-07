-- AlterTable
ALTER TABLE "anotaciones_partido" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ligas" ADD COLUMN     "reglas" JSONB;

-- AlterTable
ALTER TABLE "onesignal_tag_cleanup_jobs" ALTER COLUMN "desired" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "notification_outbox" RENAME CONSTRAINT "notification_outbox_divisionid_fkey" TO "notification_outbox_divisionId_fkey";

-- RenameForeignKey
ALTER TABLE "notification_outbox" RENAME CONSTRAINT "notification_outbox_jornadaid_fkey" TO "notification_outbox_jornadaId_fkey";

-- RenameIndex
ALTER INDEX "division_notification_subscriptions_divisionId_pushSubscription" RENAME TO "division_notification_subscriptions_divisionId_pushSubscrip_key";

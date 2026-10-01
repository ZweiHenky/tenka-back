-- AlterTable
ALTER TABLE "billing_revenuecat_reconciliations" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "billing_provider_subscriptions" RENAME CONSTRAINT "billing_provider_subscriptions_replacesProviderSubscriptionId_f" TO "billing_provider_subscriptions_replacesProviderSubscriptio_fkey";

-- RenameIndex
ALTER INDEX "billing_audit_logs_action_created_idx" RENAME TO "billing_audit_logs_action_createdAt_idx";

-- RenameIndex
ALTER INDEX "billing_audit_logs_actor_created_idx" RENAME TO "billing_audit_logs_actorUserIdSnapshot_createdAt_idx";

-- RenameIndex
ALTER INDEX "billing_audit_logs_webhook_event_created_idx" RENAME TO "billing_audit_logs_billingWebhookEventId_createdAt_idx";

-- RenameIndex
ALTER INDEX "billing_provider_periods_providerSubscriptionId_providerPeriodK" RENAME TO "billing_provider_periods_providerSubscriptionId_providerPer_key";

-- RenameIndex
ALTER INDEX "billing_provider_subscription_chains_store_providerChainReferen" RENAME TO "billing_provider_subscription_chains_store_providerChainRef_key";

-- RenameIndex
ALTER INDEX "billing_provider_subscriptions_replacesProviderSubscriptionId_i" RENAME TO "billing_provider_subscriptions_replacesProviderSubscription_idx";

-- RenameIndex
ALTER INDEX "billing_provider_subscriptions_store_providerSubscriptionKey_ke" RENAME TO "billing_provider_subscriptions_store_providerSubscriptionKe_key";

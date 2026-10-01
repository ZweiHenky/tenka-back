import { cleanupService } from '../modules/cleanup/service';
import { mediaService } from '../modules/media/service';
import { notificationService } from '../modules/notification/service';
import { env } from '../config/env';
import { processWebhookEvents, purgeProcessedWebhookPayloads } from '../modules/billing/webhookWorker';
import { processPeriodicReconciliations } from '../modules/billing/periodicReconciliationWorker';
import { processCheckoutAttempts } from '../modules/billing/checkoutAttemptWorker';
import { processBillingGraceExpirations } from '../modules/billing/billingGraceExpiryWorker';
import { processBillingMigrationExpirations } from '../modules/billing/billingMigrationExpiryWorker';
import { createDueProcessor, type BatchResult } from './dueProcessor';
import { registerJobSignal, type BackgroundJob } from './jobSignals';

interface JobDefinition {
  name: BackgroundJob;
  run: () => Promise<BatchResult>;
  maxMaintenanceBatches?: number;
}

export function backgroundJobDefinitions(): JobDefinition[] {
  const jobs: JobDefinition[] = [
    { name: 'media-deletion', run: () => mediaService.processDeletionJobs() },
    { name: 'media-intents', run: () => mediaService.cleanupExpiredIntents() },
    { name: 'tag-cleanup', run: () => cleanupService.processTagCleanupJobs() },
    { name: 'notification-outbox', run: () => notificationService.processOutboxJobs() },
    { name: 'billing-grace-expiry', run: () => processBillingGraceExpirations() },
    { name: 'billing-migration-expiry', run: () => processBillingMigrationExpirations() },
  ];
  if (env.BILLING_REVENUECAT_ENABLED) {
    jobs.push(
      { name: 'billing-webhook', run: () => processWebhookEvents() },
      { name: 'billing-webhook-retention', run: () => purgeProcessedWebhookPayloads() },
      { name: 'billing-checkout', run: () => processCheckoutAttempts(), maxMaintenanceBatches: 10 },
    );
    if (env.BILLING_PERIODIC_RECONCILIATION_ENABLED) {
      jobs.push({
        name: 'billing-reconciliation',
        run: () => processPeriodicReconciliations(),
        maxMaintenanceBatches: 10,
      });
    }
  }
  return jobs;
}

export function startCleanupWorkers() {
  const processors = backgroundJobDefinitions().map((job) => ({
    job,
    processor: createDueProcessor(job.name, job.run),
  }));
  const unregister = processors.map(({ job, processor }) => registerJobSignal(job.name, processor.signal));

  // Recover durable work after deploys, crashes, or missed process-local signals.
  for (const { processor } of processors) processor.signal();

  return async () => {
    for (const remove of unregister) remove();
    await Promise.all(processors.map(({ processor }) => processor.stop()));
  };
}

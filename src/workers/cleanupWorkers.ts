import { cleanupService } from '../modules/cleanup/service';
import { mediaService } from '../modules/media/service';
import { notificationService } from '../modules/notification/service';
import { createDueProcessor, type BatchResult } from './dueProcessor';
import { registerJobSignal, type BackgroundJob } from './jobSignals';

interface JobDefinition {
  name: BackgroundJob;
  run: () => Promise<BatchResult>;
}

export function backgroundJobDefinitions(): JobDefinition[] {
  return [
    { name: 'media-deletion', run: () => mediaService.processDeletionJobs() },
    { name: 'media-intents', run: () => mediaService.cleanupExpiredIntents() },
    { name: 'tag-cleanup', run: () => cleanupService.processTagCleanupJobs() },
    { name: 'notification-outbox', run: () => notificationService.processOutboxJobs() },
  ];
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

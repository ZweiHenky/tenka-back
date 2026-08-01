import { logger } from '../config/logger';
import { mediaService } from '../modules/media/service';
import { cleanupService } from '../modules/cleanup/service';

export function startWorker(name: string, run: () => Promise<unknown>, intervalMs: number) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> | undefined;
  const schedule = () => { if (!stopped) timer = setTimeout(execute, intervalMs); };
  const execute = () => {
    if (stopped) return;
    const startedAt = Date.now();
    active = run()
      .then(() => logger.debug({ event: 'worker.completed', worker: name, durationMs: Date.now() - startedAt }))
      .catch((error) => logger.error({ event: 'worker.failed', worker: name, durationMs: Date.now() - startedAt, err: error }))
      .finally(() => { active = undefined; schedule(); });
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

export function startCleanupWorkers(intervalMs = 60_000) {
  const stopMedia = startWorker('media-cleanup', () => mediaService.processDeletionJobs(), intervalMs);
  const stopTags = startWorker('onesignal-tag-cleanup', () => cleanupService.processTagCleanupJobs(), intervalMs);
  return async () => { await Promise.all([stopMedia(), stopTags()]); };
}

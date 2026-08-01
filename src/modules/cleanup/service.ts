import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { removeTag } from '../notification-subscription/onesignal-client';

export const cleanupService = {
  async processTagCleanupJobs(): Promise<void> {
    const jobs = await prisma.oneSignalTagCleanupJob.findMany({
      where: { nextTryAt: { lte: new Date() } },
      take: 20,
    });

    for (const job of jobs) {
      const ok = await removeTag(job.oneSignalId, job.tag);
      if (ok) {
        await prisma.oneSignalTagCleanupJob.delete({ where: { id: job.id } });
      } else {
        logger.warn({ provider: 'onesignal', operation: 'remove_tag_cleanup', status: 'retry_scheduled', timeout: false, jobId: job.id, attempts: job.attempts + 1 }, 'Provider cleanup will be retried');
        await prisma.oneSignalTagCleanupJob.update({
          where: { id: job.id },
          data: {
            attempts: { increment: 1 },
            lastError: 'onesignal removeTag failed',
            nextTryAt: new Date(Date.now() + Math.min(60000 * 2 ** job.attempts, 86400000)),
          },
        });
      }
    }
  },
};

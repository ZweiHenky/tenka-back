import './instrument';
import { prisma } from './config/database';
import { logger } from './config/logger';
import { Sentry } from './instrument';
import { backgroundJobDefinitions } from './workers/cleanupWorkers';

const MAX_BATCHES_PER_JOB = 1_000;

async function runMaintenance(): Promise<void> {
  const definitions = backgroundJobDefinitions();
  definitions.sort((a, b) => Number(a.name === 'media-deletion') - Number(b.name === 'media-deletion'));

  for (const job of definitions) {
    let processedCount = 0;
    let nextDueAt: Date | null = null;
    for (let batch = 0; batch < MAX_BATCHES_PER_JOB; batch += 1) {
      const result = await job.run();
      processedCount += result.processedCount;
      nextDueAt = result.nextDueAt;
      if (result.processedCount === 0 || !nextDueAt || nextDueAt.getTime() > Date.now()) break;
    }
    logger.info({ event: 'maintenance.job_completed', worker: job.name, processedCount, nextDueAt });
  }
}

async function main(): Promise<void> {
  try {
    await runMaintenance();
  } catch (error) {
    Sentry.captureException(error);
    logger.fatal({ event: 'maintenance.failed', err: error });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await Sentry.close(2_000);
  }
}

void main();

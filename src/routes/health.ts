import { Router } from 'express';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { isReadyForTraffic } from '../config/readiness';

type HealthDependencies = {
  checkDatabase: () => Promise<unknown>;
  isReady: () => boolean;
  timeoutMs: number;
};

const defaultDependencies: HealthDependencies = {
  checkDatabase: () => prisma.$queryRawUnsafe('SELECT 1'),
  isReady: isReadyForTraffic,
  timeoutMs: env.READINESS_TIMEOUT_MS,
};

async function withDeadline(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('readiness_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createHealthRouter(overrides: Partial<HealthDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const router = Router();

  const live = (_req: unknown, res: any) => res.status(200).json({ status: 'ok' });

  router.get('/live', live);
  router.get('/api/health', live);
  router.get('/ready', async (_req, res) => {
    if (!dependencies.isReady()) {
      res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
      return;
    }
    try {
      await withDeadline(dependencies.checkDatabase(), dependencies.timeoutMs);
      res.status(200).json({ status: 'ready' });
    } catch (error) {
      const reason = error instanceof Error && error.message === 'readiness_timeout' ? 'database_timeout' : 'database_error';
      res.status(503).json({ status: 'not_ready', reason });
    }
  });

  return router;
}

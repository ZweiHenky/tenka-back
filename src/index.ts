import './instrument';
import app from './app';
import { Sentry } from './instrument';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/database';
import { markNotReady } from './config/readiness';
import { startCleanupWorkers } from './workers/cleanupWorkers';

const server = app.listen(env.PORT, () => logger.info({ event: 'server.started', port: env.PORT }));
server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
const stopWorkers = startCleanupWorkers();
let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  markNotReady();
  logger.info({ event: 'server.shutdown.started', signal });

  const graceful = (async () => {
    await stopWorkers();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
    await Sentry.close(2_000);
  })();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('shutdown_timeout')), env.SHUTDOWN_GRACE_MS).unref();
  });

  try {
    await Promise.race([graceful, timeout]);
    logger.info({ event: 'server.shutdown.completed' });
    process.exit(exitCode);
  } catch (error) {
    logger.fatal({ event: 'server.shutdown.failed', err: error });
    await Sentry.close(1_000);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('unhandledRejection', (error) => {
  Sentry.captureException(error);
  logger.fatal({ event: 'process.unhandled_rejection', err: error });
  void shutdown('unhandledRejection', 1);
});
process.once('uncaughtException', (error) => {
  Sentry.captureException(error);
  logger.fatal({ event: 'process.uncaught_exception', err: error });
  void shutdown('uncaughtException', 1);
});

export default app;

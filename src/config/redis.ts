import { createClient } from 'redis';
import { env } from './env';
import { logger } from './logger';

export const redis = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: env.PROVIDER_TIMEOUT_MS,
    reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 5_000),
  },
});

redis.on('error', (error) => logger.error({ event: 'redis.error', err: error }));

export async function connectRedis(): Promise<void> {
  if (redis.isOpen) return;
  await redis.connect();
  logger.info({ event: 'redis.connected' });
}

export async function disconnectRedis(): Promise<void> {
  if (!redis.isOpen) return;
  await redis.close();
  logger.info({ event: 'redis.disconnected' });
}

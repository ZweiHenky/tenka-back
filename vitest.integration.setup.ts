import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll } from 'vitest';
import { PrismaClient } from './src/generated/prisma/client';
import {
  getIntegrationDatabaseUrl,
  getIntegrationPgConnectionString,
  INTEGRATION_SCHEMA,
} from './src/test/integration/database';

// setupFiles run before test modules, so production services cannot capture the application URL.
process.env.DATABASE_URL = getIntegrationDatabaseUrl();
process.env.NODE_ENV = 'test';

const integrationPrisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: getIntegrationPgConnectionString() },
    { schema: INTEGRATION_SCHEMA },
  ),
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
if (globalForPrisma.prisma) {
  throw new Error('Prisma was initialized before the integration setup file');
}
globalForPrisma.prisma = integrationPrisma;

afterAll(async () => {
  await integrationPrisma.$disconnect();
  delete globalForPrisma.prisma;
});

import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

const DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';

export function assertDevelopmentScriptContext(): void {
  if (process.env.DEVELOPMENT_SCRIPT_AUTH !== DEVELOPMENT_SCRIPT_AUTH) {
    throw new Error('Direct database script execution is disabled. Use a pnpm db:script:* command.');
  }
  if (env.APP_ENV !== 'local' || env.DB_TARGET !== 'development') {
    throw new Error('Database scripts are only allowed for the development target.');
  }
}

export function createDevelopmentPrismaClient(): PrismaClient {
  assertDevelopmentScriptContext();
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
}

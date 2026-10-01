import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

const PRODUCTION_BILLING_SCRIPT_AUTH = 'tenka-production-billing-script-v1';

export function assertProductionBillingScriptContext(): void {
  if (process.env.PRODUCTION_BILLING_SCRIPT_AUTH !== PRODUCTION_BILLING_SCRIPT_AUTH) {
    throw new Error('Direct production billing script execution is disabled. Use the protected pnpm command.');
  }
  if (env.APP_ENV !== 'production' || env.DB_TARGET !== 'production') {
    throw new Error('Production billing scripts require the production target.');
  }
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production'
    || !process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_SERVICE_ID) {
    throw new Error('Production billing scripts require Railway production context.');
  }
}

export function createProductionBillingPrismaClient(): PrismaClient {
  assertProductionBillingScriptContext();
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
}

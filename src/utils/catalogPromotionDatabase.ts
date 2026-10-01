import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

const CATALOG_PROMOTION_AUTH = 'tenka-billing-catalog-promotion-script-v1';

export function assertBillingCatalogPromotionContext(target: 'preview' | 'production'): void {
  if (process.env.BILLING_CATALOG_PROMOTION_SCRIPT_AUTH !== CATALOG_PROMOTION_AUTH) {
    throw new Error('Direct billing catalog promotion execution is disabled. Use the protected pnpm command.');
  }
  if (process.env.BILLING_CATALOG_PROMOTION_TARGET !== target
    || env.APP_ENV !== target || env.DB_TARGET !== target) {
    throw new Error(`Billing catalog promotion requires the ${target} target.`);
  }
  const expectedRailwayEnvironment = target === 'production' ? 'production' : 'staging';
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== expectedRailwayEnvironment
    || !process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_SERVICE_ID) {
    throw new Error(`Billing catalog promotion requires Railway ${expectedRailwayEnvironment} context.`);
  }
}

export function createBillingCatalogPromotionPrismaClient(target: 'preview' | 'production'): PrismaClient {
  assertBillingCatalogPromotionContext(target);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
}

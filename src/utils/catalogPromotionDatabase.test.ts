import { afterEach, describe, expect, it } from 'vitest';
import { assertBillingCatalogPromotionContext } from './catalogPromotionDatabase';

const original = {
  auth: process.env.BILLING_CATALOG_PROMOTION_SCRIPT_AUTH,
  target: process.env.BILLING_CATALOG_PROMOTION_TARGET,
  railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
  railwayProject: process.env.RAILWAY_PROJECT_ID,
  railwayService: process.env.RAILWAY_SERVICE_ID,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    BILLING_CATALOG_PROMOTION_SCRIPT_AUTH: original.auth,
    BILLING_CATALOG_PROMOTION_TARGET: original.target,
    RAILWAY_ENVIRONMENT_NAME: original.railwayEnvironment,
    RAILWAY_PROJECT_ID: original.railwayProject,
    RAILWAY_SERVICE_ID: original.railwayService,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('billing catalog promotion database guard', () => {
  it('blocks direct execution without the wrapper marker', () => {
    delete process.env.BILLING_CATALOG_PROMOTION_SCRIPT_AUTH;
    expect(() => assertBillingCatalogPromotionContext('preview')).toThrow('Direct billing catalog promotion');
  });

  it('blocks a marker whose target does not match the process environment', () => {
    process.env.BILLING_CATALOG_PROMOTION_SCRIPT_AUTH = 'tenka-billing-catalog-promotion-script-v1';
    process.env.BILLING_CATALOG_PROMOTION_TARGET = 'production';
    expect(() => assertBillingCatalogPromotionContext('preview')).toThrow('requires the preview target');
  });
});

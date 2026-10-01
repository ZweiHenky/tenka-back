import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../config/env';
import { backgroundJobDefinitions } from './cleanupWorkers';

const originalRevenueCatEnabled = env.BILLING_REVENUECAT_ENABLED;
const originalPeriodicEnabled = env.BILLING_PERIODIC_RECONCILIATION_ENABLED;

afterEach(() => {
  env.BILLING_REVENUECAT_ENABLED = originalRevenueCatEnabled;
  env.BILLING_PERIODIC_RECONCILIATION_ENABLED = originalPeriodicEnabled;
});

describe('background billing jobs', () => {
  it('does not register provider jobs while RevenueCat is disabled', () => {
    env.BILLING_REVENUECAT_ENABLED = false;
    env.BILLING_PERIODIC_RECONCILIATION_ENABLED = false;
    expect(backgroundJobDefinitions().map(({ name }) => name))
      .not.toContain('billing-reconciliation');
    expect(backgroundJobDefinitions().map(({ name }) => name))
      .toContain('billing-grace-expiry');
  });

  it('registers periodic reconciliation only behind its separate cost-control flag', () => {
    env.BILLING_REVENUECAT_ENABLED = true;
    env.BILLING_PERIODIC_RECONCILIATION_ENABLED = false;
    expect(backgroundJobDefinitions().map(({ name }) => name))
      .not.toContain('billing-reconciliation');

    env.BILLING_PERIODIC_RECONCILIATION_ENABLED = true;
    const job = backgroundJobDefinitions().find(({ name }) => name === 'billing-reconciliation');
    expect(job).toMatchObject({ name: 'billing-reconciliation', maxMaintenanceBatches: 10 });
  });
});

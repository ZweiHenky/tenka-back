import { afterEach, describe, expect, it } from 'vitest';
import { assertProductionBillingScriptContext } from './productionDatabase';

const originalMarker = process.env.PRODUCTION_BILLING_SCRIPT_AUTH;

afterEach(() => {
  if (originalMarker === undefined) delete process.env.PRODUCTION_BILLING_SCRIPT_AUTH;
  else process.env.PRODUCTION_BILLING_SCRIPT_AUTH = originalMarker;
});

describe('production billing database guard', () => {
  it('blocks direct execution without the protected wrapper marker', () => {
    delete process.env.PRODUCTION_BILLING_SCRIPT_AUTH;
    expect(() => assertProductionBillingScriptContext()).toThrow('Direct production billing script execution is disabled');
  });

  it('blocks a valid marker outside the production target', () => {
    process.env.PRODUCTION_BILLING_SCRIPT_AUTH = 'tenka-production-billing-script-v1';
    expect(() => assertProductionBillingScriptContext()).toThrow('require the production target');
  });
});

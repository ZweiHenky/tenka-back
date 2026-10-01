import { describe, expect, it } from 'vitest';
import { auditCatalogPricingEvidence } from './catalogAudit';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';

function validEvidence() {
  return {
    schemaVersion: 1,
    catalogVersion: '2026-09-mx-v1',
    status: 'APPROVED',
    approvedOn: '2026-09-13',
    currency: 'MXN',
    territories: ['MX'],
    priceBasis: {
      monthlyCustomerPricePerDivision: 129,
      quarterlyDiscountPercent: 10,
      annualDiscountPercent: 20,
      googleAssumedTaxPercent: 16,
      googleConfiguredPricesExcludeTax: true,
      appleCustomerPricesIncludeApplicableTax: true,
    },
    unresolvedIssues: [],
    capacities: Array.from({ length: 14 }, (_, index) => {
      const capacity = index + 2;
      const monthly = capacity * 129;
      const price = (target: number) => ({
        targetCustomerPriceMxn: target,
        appleCustomerPriceMxn: target,
        googleConfiguredPriceBeforeTaxMxn: Math.round(target / 1.16 * 100) / 100,
        googleExpectedCustomerPriceMxn: target,
      });
      return {
        capacity,
        prices: {
          monthly: price(monthly),
          quarterly: price(monthly * 3 * 0.9),
          annual: price(monthly * 12 * 0.8),
        },
      };
    }),
  };
}

describe('billing catalog pricing audit', () => {
  it('validates the complete commercial and physical matrices', () => {
    expect(auditCatalogPricingEvidence(MX_2026_09_V1_CATALOG_MANIFEST, validEvidence())).toEqual({
      commercialVariantCount: 42,
      physicalProductCount: 84,
      maxAppleVariancePercent: 0,
    });
  });

  it('rejects unresolved issues and cross-store differences above 5%', () => {
    expect(() => auditCatalogPricingEvidence(MX_2026_09_V1_CATALOG_MANIFEST, {
      ...validEvidence(),
      unresolvedIssues: [{ reason: 'pending' }],
    })).toThrow('problemas de precio sin resolver');

    const evidence = validEvidence();
    evidence.capacities[0].prices.monthly.appleCustomerPriceMxn = 300;
    expect(() => auditCatalogPricingEvidence(MX_2026_09_V1_CATALOG_MANIFEST, evidence))
      .toThrow('difieren mas de 5%');
  });
});

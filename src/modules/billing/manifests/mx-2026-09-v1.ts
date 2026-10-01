import type { BillingCatalogManifest, BillingIntervalName } from '../types';

const CAPACITIES = Array.from({ length: 14 }, (_, index) => index + 2);
const INTERVALS: ReadonlyArray<{
  billingInterval: BillingIntervalName;
  intervalMonths: number;
  packageId: string;
  productSuffix: string;
  googleBasePlanId: string;
}> = [
  {
    billingInterval: 'MONTHLY',
    intervalMonths: 1,
    packageId: '$rc_monthly',
    productSuffix: 'monthly',
    googleBasePlanId: 'monthly',
  },
  {
    billingInterval: 'QUARTERLY',
    intervalMonths: 3,
    packageId: '$rc_three_month',
    productSuffix: 'quarterly',
    googleBasePlanId: 'quarterly',
  },
  {
    billingInterval: 'ANNUAL',
    intervalMonths: 12,
    packageId: '$rc_annual',
    productSuffix: 'annual',
    googleBasePlanId: 'annual',
  },
];

export const MX_2026_09_V1_CATALOG_MANIFEST: BillingCatalogManifest = {
  version: '2026-09-mx-v1',
  entitlementId: 'league_management',
  territories: ['MX'],
  products: CAPACITIES.flatMap((capacity) => {
    const logicalProductId = `tenka_capacity_${capacity}`;
    const revenueCatOfferingId = `capacity_${capacity}`;

    return INTERVALS.flatMap((interval) => {
      const appleProductId = `studio.tenka.capacity${capacity}.${interval.productSuffix}.v1`;

      return [
        {
          logicalProductId,
          store: 'APPLE' as const,
          storeProductId: appleProductId,
          basePlanId: null,
          revenueCatOfferingId,
          revenueCatPackageId: interval.packageId,
          revenueCatProductIdentifier: appleProductId,
          capacity,
          billingInterval: interval.billingInterval,
          intervalMonths: interval.intervalMonths,
          active: true,
        },
        {
          logicalProductId,
          store: 'GOOGLE' as const,
          storeProductId: logicalProductId,
          basePlanId: interval.googleBasePlanId,
          revenueCatOfferingId,
          revenueCatPackageId: interval.packageId,
          revenueCatProductIdentifier: `${logicalProductId}:${interval.googleBasePlanId}`,
          capacity,
          billingInterval: interval.billingInterval,
          intervalMonths: interval.intervalMonths,
          active: true,
        },
      ];
    });
  }),
};

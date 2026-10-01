import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  activateCatalogRelease,
  BILLING_CATALOG_PHYSICAL_PRODUCT_COUNT,
  billingEnvironmentForApp,
  validateCatalogProducts,
} from './catalog';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import type { BillingCatalogProductInput } from './types';

export function completeCatalogProducts(): BillingCatalogProductInput[] {
  return MX_2026_09_V1_CATALOG_MANIFEST.products.map((product) => ({ ...product }));
}

describe('billing product catalog validation', () => {
  it('accepts exactly 42 commercial variants represented in both stores', () => {
    const products = completeCatalogProducts();
    expect(products).toHaveLength(84);
    expect(BILLING_CATALOG_PHYSICAL_PRODUCT_COUNT).toBe(84);
    expect(() => validateCatalogProducts(products)).not.toThrow();
  });

  it('uses the definitive release metadata and unique physical identifiers', () => {
    const { products } = MX_2026_09_V1_CATALOG_MANIFEST;
    expect(MX_2026_09_V1_CATALOG_MANIFEST.version).toBe('2026-09-mx-v1');
    expect(MX_2026_09_V1_CATALOG_MANIFEST.entitlementId).toBe('league_management');
    expect(MX_2026_09_V1_CATALOG_MANIFEST.territories).toEqual(['MX']);
    expect(new Set(products.map(({ store, storeProductId, basePlanId }) => `${store}:${storeProductId}:${basePlanId ?? ''}`)).size).toBe(84);
    expect(new Set(products.map(({ store, revenueCatProductIdentifier }) => `${store}:${revenueCatProductIdentifier}`)).size).toBe(84);
    expect(products.find((product) => product.capacity === 2 && product.store === 'APPLE' && product.billingInterval === 'MONTHLY'))
      .toMatchObject({
        storeProductId: 'studio.tenka.capacity2.monthly.v1',
        revenueCatProductIdentifier: 'studio.tenka.capacity2.monthly.v1',
      });
    expect(products.find((product) => product.capacity === 15 && product.store === 'GOOGLE' && product.billingInterval === 'ANNUAL'))
      .toMatchObject({
        storeProductId: 'tenka_capacity_15',
        basePlanId: 'annual',
        revenueCatProductIdentifier: 'tenka_capacity_15:annual',
      });
  });

  it('rejects an incomplete release', () => {
    expect(() => validateCatalogProducts(completeCatalogProducts().slice(1)))
      .toThrow('exactamente 84 variantes físicas activas');
  });

  it('rejects inactive rows instead of activating a partial matrix', () => {
    const products = completeCatalogProducts();
    products[0] = { ...products[0], active: false };
    expect(() => validateCatalogProducts(products)).toThrow('exactamente 84 variantes físicas activas');
  });

  it('rejects duplicate store-capacity-interval combinations', () => {
    const products = completeCatalogProducts();
    products[products.length - 1] = { ...products[0] };
    expect(() => validateCatalogProducts(products)).toThrow('repite la variante');
  });

  it('rejects logical ids, packages and base plans inconsistent with configured values', () => {
    const products = completeCatalogProducts();
    expect(() => validateCatalogProducts([{ ...products[0], logicalProductId: 'client_supplied_15' }, ...products.slice(1)]))
      .toThrow('mapeo lógico inconsistente');
    expect(() => validateCatalogProducts([{ ...products[1], basePlanId: 'annual' }, products[0], ...products.slice(2)]))
      .toThrow('plan base incompatible');
  });

  it('rejects store and RevenueCat identifiers outside the definitive convention', () => {
    const products = completeCatalogProducts();
    expect(() => validateCatalogProducts([
      { ...products[0], storeProductId: 'studio.tenka.capacity2.monthly' },
      ...products.slice(1),
    ])).toThrow('mapeo físico inconsistente');
    expect(() => validateCatalogProducts([
      products[0],
      { ...products[1], revenueCatProductIdentifier: 'tenka_capacity_2:wrong' },
      ...products.slice(2),
    ])).toThrow('mapeo físico inconsistente');
  });

  it('maps local and preview to the isolated catalog environment', () => {
    expect(billingEnvironmentForApp('local')).toBe('PREVIEW');
    expect(billingEnvironmentForApp('preview')).toBe('PREVIEW');
    expect(billingEnvironmentForApp('production')).toBe('PRODUCTION');
  });

  it('treats an exact active release as an idempotent activation', async () => {
    const update = vi.fn();
    const updateMany = vi.fn();
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ environment: 'PREVIEW' })
      .mockResolvedValueOnce({
        id: 'release-1', environment: 'PREVIEW', status: 'ACTIVE',
        approvedAt: new Date(), activatedAt: new Date(),
        products: completeCatalogProducts(),
      });
    const tx = {
      $executeRawUnsafe: vi.fn(),
      billingCatalogRelease: { findUnique, update, updateMany },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as unknown as PrismaClient;

    await expect(activateCatalogRelease('release-1', client)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { approveCatalogManifestRelease, catalogManifestSha256, loadCatalogManifestDraft } from './catalogDraft';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';

function release(overrides: Record<string, unknown> = {}) {
  return {
    id: 'release-1',
    version: MX_2026_09_V1_CATALOG_MANIFEST.version,
    environment: 'PREVIEW' as const,
    status: 'DRAFT' as const,
    approvedAt: null,
    activatedAt: null,
    createdAt: new Date(),
    products: MX_2026_09_V1_CATALOG_MANIFEST.products.map((product, index) => ({
      ...product,
      id: `product-${index}`,
      catalogReleaseId: 'release-1',
      createdAt: new Date(),
    })),
    ...overrides,
  };
}

function prismaReturning(value: ReturnType<typeof release>): PrismaClient {
  const upsert = vi.fn().mockResolvedValue(value);
  return {
    $transaction: vi.fn(async (callback) => callback({ billingCatalogRelease: { upsert } })),
  } as unknown as PrismaClient;
}

describe('billing catalog draft loader', () => {
  it('has a stable approved manifest digest', () => {
    expect(catalogManifestSha256(MX_2026_09_V1_CATALOG_MANIFEST))
      .toBe('9bb80fc393409a4536c3ec171f47a663127fc50ce7c5b383d663b29f46fb751c');
  });

  it('accepts an exact existing DRAFT idempotently', async () => {
    await expect(loadCatalogManifestDraft(
      prismaReturning(release()),
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).resolves.toEqual({
      id: 'release-1',
      version: '2026-09-mx-v1',
      environment: 'PREVIEW',
      productCount: 84,
    });
  });

  it('approves an exact DRAFT without activating it', async () => {
    const value = release();
    const approvedAt = new Date('2026-09-13T12:00:00.000Z');
    const update = vi.fn().mockResolvedValue({ id: value.id, approvedAt });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({
        billingCatalogRelease: {
          findUnique: vi.fn().mockResolvedValue(value),
          update,
        },
      })),
    } as unknown as PrismaClient;

    await expect(approveCatalogManifestRelease(
      prisma,
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).resolves.toEqual({ id: 'release-1', approvedAt, status: 'DRAFT' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { approvedAt: expect.any(Date) } }));
  });

  it('treats the exact ACTIVE release as an idempotent approval', async () => {
    const approvedAt = new Date('2026-09-13T12:00:00.000Z');
    const value = release({ status: 'ACTIVE', approvedAt, activatedAt: new Date() });
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({
        billingCatalogRelease: { findUnique: vi.fn().mockResolvedValue(value) },
      })),
    } as unknown as PrismaClient;

    await expect(approveCatalogManifestRelease(
      prisma,
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).resolves.toEqual({ id: 'release-1', approvedAt, status: 'ACTIVE' });
  });

  it('rejects an existing release whose products differ from the manifest', async () => {
    const changed = release();
    changed.products[0] = { ...changed.products[0], active: false };
    await expect(loadCatalogManifestDraft(
      prismaReturning(changed),
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).rejects.toThrow();
  });

  it('accepts an exact approved or active release idempotently', async () => {
    const approvedAt = new Date('2026-09-13T12:00:00.000Z');
    await expect(loadCatalogManifestDraft(
      prismaReturning(release({ approvedAt })),
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).resolves.toMatchObject({ id: 'release-1', productCount: 84 });
    await expect(loadCatalogManifestDraft(
      prismaReturning(release({ status: 'ACTIVE', approvedAt, activatedAt: new Date() })),
      'PREVIEW',
      MX_2026_09_V1_CATALOG_MANIFEST,
    )).resolves.toMatchObject({ id: 'release-1', productCount: 84 });
  });
});

import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { validateCatalogProducts } from './catalog';
import type {
  BillingCatalogManifest,
  BillingCatalogProductInput,
  BillingEnvironmentName,
} from './types';

function persistedProduct(product: BillingCatalogProductInput) {
  return {
    logicalProductId: product.logicalProductId,
    store: product.store,
    storeProductId: product.storeProductId,
    basePlanId: product.basePlanId,
    revenueCatOfferingId: product.revenueCatOfferingId,
    revenueCatPackageId: product.revenueCatPackageId,
    revenueCatProductIdentifier: product.revenueCatProductIdentifier,
    capacity: product.capacity,
    billingInterval: product.billingInterval,
    intervalMonths: product.intervalMonths,
    active: product.active,
  };
}

function productFingerprint(products: ReadonlyArray<BillingCatalogProductInput>): string {
  const normalized = products
    .map(persistedProduct)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(normalized);
}

export function catalogManifestSha256(manifest: BillingCatalogManifest): string {
  return createHash('sha256').update(JSON.stringify({
    version: manifest.version,
    entitlementId: manifest.entitlementId,
    territories: [...manifest.territories].sort(),
    products: manifest.products.map(persistedProduct)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  })).digest('hex');
}

export async function loadCatalogManifestDraft(
  prisma: PrismaClient,
  environment: BillingEnvironmentName,
  manifest: BillingCatalogManifest,
): Promise<{ id: string; version: string; environment: BillingEnvironmentName; productCount: number }> {
  validateCatalogProducts(manifest.products);

  return prisma.$transaction(async (tx) => {
    const release = await tx.billingCatalogRelease.upsert({
      where: { environment_version: { environment, version: manifest.version } },
      update: {},
      create: {
        version: manifest.version,
        environment,
        status: 'DRAFT',
        products: { create: manifest.products.map(persistedProduct) },
      },
      include: { products: true },
    });

    validateCatalogProducts(release.products);
    if (productFingerprint(release.products) !== productFingerprint(manifest.products)) {
      throw new ValidationError('La release existente no coincide con el manifest versionado');
    }
    if (release.status === 'RETIRED') {
      throw new ValidationError('La release existente fue retirada');
    }
    if ((release.status === 'ACTIVE' && (!release.approvedAt || !release.activatedAt))
      || (release.status === 'DRAFT' && release.activatedAt)) {
      throw new ValidationError('La release existente tiene fechas de control inconsistentes');
    }

    return {
      id: release.id,
      version: release.version,
      environment: release.environment,
      productCount: release.products.length,
    };
  });
}

export async function approveCatalogManifestRelease(
  prisma: PrismaClient,
  environment: BillingEnvironmentName,
  manifest: BillingCatalogManifest,
): Promise<{ id: string; approvedAt: Date; status: 'DRAFT' | 'ACTIVE' }> {
  validateCatalogProducts(manifest.products);

  return prisma.$transaction(async (tx) => {
    const release = await tx.billingCatalogRelease.findUnique({
      where: { environment_version: { environment, version: manifest.version } },
      include: { products: true },
    });
    if (!release) throw new NotFoundError('Release de catálogo');
    if (release.status === 'RETIRED') {
      throw new ValidationError('Solo una release DRAFT puede aprobarse');
    }
    validateCatalogProducts(release.products);
    if (productFingerprint(release.products) !== productFingerprint(manifest.products)) {
      throw new ValidationError('La release existente no coincide con el manifest versionado');
    }
    if (release.status === 'ACTIVE') {
      if (!release.approvedAt || !release.activatedAt) throw new ValidationError('La release ACTIVE tiene fechas de control inconsistentes');
      return { id: release.id, approvedAt: release.approvedAt, status: 'ACTIVE' };
    }
    if (release.activatedAt) throw new ValidationError('La release DRAFT no puede tener fecha de activacion');
    if (release.approvedAt) return { id: release.id, approvedAt: release.approvedAt, status: 'DRAFT' };

    const approved = await tx.billingCatalogRelease.update({
      where: { id: release.id },
      data: { approvedAt: new Date() },
      select: { id: true, approvedAt: true },
    });
    return { id: approved.id, approvedAt: approved.approvedAt!, status: 'DRAFT' };
  });
}

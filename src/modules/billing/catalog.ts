import { env } from '../../config/env';
import { prisma } from '../../config/database';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors';
import type {
  BillingCatalogDto,
  BillingCatalogProductInput,
  BillingEnvironmentName,
  BillingIntervalName,
  BillingStoreName,
} from './types';
import { resolvePurchasesEnabled } from './operationalControlService';

const CAPACITIES = Array.from({ length: 14 }, (_, index) => index + 2);
const STORES: BillingStoreName[] = ['APPLE', 'GOOGLE'];
const INTERVALS: Array<{
  interval: BillingIntervalName;
  months: number;
  packageId: string;
  googleBasePlanId: string;
  appleProductSuffix: string;
}> = [
  { interval: 'MONTHLY', months: 1, packageId: '$rc_monthly', googleBasePlanId: 'monthly', appleProductSuffix: 'monthly' },
  { interval: 'QUARTERLY', months: 3, packageId: '$rc_three_month', googleBasePlanId: 'quarterly', appleProductSuffix: 'quarterly' },
  { interval: 'ANNUAL', months: 12, packageId: '$rc_annual', googleBasePlanId: 'annual', appleProductSuffix: 'annual' },
];

export const BILLING_CATALOG_PHYSICAL_PRODUCT_COUNT = CAPACITIES.length * INTERVALS.length * STORES.length;

type BillingCatalogClient = Pick<PrismaClient, 'billingCatalogRelease' | 'billingOperationalControl'>;

function matrixKey(product: BillingCatalogProductInput): string {
  return `${product.capacity}:${product.billingInterval}:${product.store}`;
}

export function validateCatalogProducts(products: ReadonlyArray<BillingCatalogProductInput>): void {
  if (products.length !== BILLING_CATALOG_PHYSICAL_PRODUCT_COUNT || products.some((product) => !product.active)) {
    throw new ValidationError(`La release debe contener exactamente ${BILLING_CATALOG_PHYSICAL_PRODUCT_COUNT} variantes físicas activas`);
  }

  const observed = new Set<string>();
  for (const product of products) {
    const interval = INTERVALS.find(({ interval: candidate }) => candidate === product.billingInterval);
    if (!CAPACITIES.includes(product.capacity) || !interval || !STORES.includes(product.store)) {
      throw new ValidationError('La release contiene una combinación de capacidad, periodicidad o tienda desconocida');
    }
    if (product.logicalProductId !== `tenka_capacity_${product.capacity}`
      || product.revenueCatOfferingId !== `capacity_${product.capacity}`
      || product.revenueCatPackageId !== interval.packageId
      || product.intervalMonths !== interval.months) {
      throw new ValidationError('La release contiene un mapeo lógico inconsistente');
    }
    const expectedBasePlan = product.store === 'GOOGLE' ? interval.googleBasePlanId : null;
    if (product.basePlanId !== expectedBasePlan) {
      throw new ValidationError('La release contiene un plan base incompatible con la tienda o periodicidad');
    }
    const expectedStoreProductId = product.store === 'APPLE'
      ? `studio.tenka.capacity${product.capacity}.${interval.appleProductSuffix}.v1`
      : product.logicalProductId;
    const expectedRevenueCatProductIdentifier = product.store === 'APPLE'
      ? expectedStoreProductId
      : `${expectedStoreProductId}:${interval.googleBasePlanId}`;
    if (product.storeProductId !== expectedStoreProductId
      || product.revenueCatProductIdentifier !== expectedRevenueCatProductIdentifier) {
      throw new ValidationError('La release contiene un mapeo físico inconsistente');
    }

    const key = matrixKey(product);
    if (observed.has(key)) throw new ValidationError(`La release repite la variante ${key}`);
    observed.add(key);
  }

  for (const capacity of CAPACITIES) {
    for (const { interval } of INTERVALS) {
      for (const store of STORES) {
        const key = `${capacity}:${interval}:${store}`;
        if (!observed.has(key)) throw new ValidationError(`Falta la variante ${key}`);
      }
    }
  }
}

export function billingEnvironmentForApp(appEnvironment = env.APP_ENV): BillingEnvironmentName {
  return appEnvironment === 'production' ? 'PRODUCTION' : 'PREVIEW';
}

export async function activateCatalogRelease(releaseId: string, client: PrismaClient = prisma): Promise<void> {
  await client.$transaction(async (tx) => {
    const candidate = await tx.billingCatalogRelease.findUnique({
      where: { id: releaseId },
      select: { environment: true },
    });
    if (!candidate) throw new NotFoundError('Release de catálogo');

    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `billing-catalog:${candidate.environment}`,
    );
    const release = await tx.billingCatalogRelease.findUnique({
      where: { id: releaseId },
      include: { products: true },
    });
    if (!release) throw new NotFoundError('Release de catálogo');
    if (release.status === 'ACTIVE') {
      if (!release.approvedAt || !release.activatedAt) {
        throw new ValidationError('La release ACTIVE tiene fechas de control inconsistentes');
      }
      validateCatalogProducts(release.products);
      return;
    }
    if (release.status !== 'DRAFT') throw new ValidationError('Solo una release DRAFT puede activarse');
    if (!release.approvedAt) throw new ValidationError('La release debe estar aprobada antes de activarse');
    validateCatalogProducts(release.products);

    await tx.billingCatalogRelease.updateMany({
      where: { environment: release.environment, status: 'ACTIVE' },
      data: { status: 'RETIRED' },
    });
    await tx.billingCatalogRelease.update({
      where: { id: release.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
  });
}

export async function getActiveBillingCatalog(
  environment: BillingEnvironmentName = billingEnvironmentForApp(),
  client: BillingCatalogClient = prisma,
): Promise<BillingCatalogDto> {
  const release = await client.billingCatalogRelease.findFirst({
    where: { environment, status: 'ACTIVE' },
    select: {
      id: true,
      version: true,
      products: {
        where: { active: true },
        orderBy: [{ capacity: 'asc' }, { billingInterval: 'asc' }, { store: 'asc' }],
        select: {
          id: true,
          logicalProductId: true,
          store: true,
          storeProductId: true,
          basePlanId: true,
          revenueCatOfferingId: true,
          revenueCatPackageId: true,
          revenueCatProductIdentifier: true,
          capacity: true,
          billingInterval: true,
          intervalMonths: true,
          active: true,
        },
      },
    },
  });

  if (!release) return { available: false, environment, release: null, purchasesEnabled: false };
  try {
    validateCatalogProducts(release.products);
  } catch (error) {
    throw new AppError(503, 'El catálogo de billing activo no es válido', 'BILLING_CATALOG_INVALID', {
      releaseId: release.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  return {
    available: true,
    environment,
    release: { id: release.id, version: release.version, products: release.products },
    purchasesEnabled: await resolvePurchasesEnabled(environment, true, client),
  };
}

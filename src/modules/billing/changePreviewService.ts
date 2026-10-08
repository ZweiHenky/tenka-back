import { createHash } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { Prisma, type BillingChangeOperationStatus, type PrismaClient } from '../../generated/prisma/client';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import { resolvePaidAccessShadowInTransaction } from './paidAccessShadow';
import { acquireBillingAccountLock, ensureBillingAccount } from './service';
import { signalBackgroundJob } from '../../workers/jobSignals';
import type {
  BillingChangeConfirmBody,
  BillingChangeFinalStepConfirmBody,
  BillingChangePreviewBody,
  BillingChangeOperationParams,
} from './changePreviewValidator';
import type { BillingCatalogProductInput, BillingChangeVariantDto, BillingIntervalName, BillingStoreName } from './types';

export type BillingChangeDirection = 'UPGRADE' | 'DOWNGRADE' | 'SAME';
export type BillingChangeTiming = 'IMMEDIATE' | 'DEFERRED' | 'TWO_STEP';
export type BillingChangePreviewReason =
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'NO_PAID_ACCESS'
  | 'LOCAL_GRACE'
  | 'EVIDENCE_INVALID'
  | 'CURRENT_VARIANT_UNKNOWN'
  | 'UNSUPPORTED_STORE'
  | 'NO_CHANGE';

export interface BillingChangePreviewDto {
  previewFingerprint: string;
  eligible: boolean;
  reason: BillingChangePreviewReason | null;
  store: BillingStoreName;
  current: BillingChangeVariantDto | null;
  target: BillingChangeVariantDto;
  direction: BillingChangeDirection | null;
  timing: BillingChangeTiming | null;
  requiresRenewalSelection: boolean;
  firstStep: BillingChangeVariantDto | null;
  operationId: string | null;
  operationStatus: BillingChangeOperationStatus | null;
}

export interface BillingChangeOperationDto {
  id: string;
  status: BillingChangeOperationStatus;
  version: number;
}

interface ChangeActor { userId: string; requestId: string }

const TERMINAL_STATUSES: BillingChangeOperationStatus[] = ['COMPLETED', 'CANCELED', 'ABANDONED'];

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function previewFingerprint(preview: Omit<BillingChangePreviewDto, 'previewFingerprint'>): string {
  return fingerprint({
    sourceVariantId: preview.current?.variantId ?? null,
    intermediateVariantId: preview.firstStep?.variantId ?? null,
    targetVariantId: preview.target.variantId,
    store: preview.store,
    direction: preview.direction,
    timing: preview.timing,
    requiresRenewalSelection: preview.requiresRenewalSelection,
  });
}

function fingerprintPreview(preview: Omit<BillingChangePreviewDto, 'previewFingerprint'>): BillingChangePreviewDto {
  return { ...preview, previewFingerprint: previewFingerprint(preview) };
}

async function assertLeagueActor(client: Pick<Prisma.TransactionClient, 'user'>, userId: string): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');
  if (user.rol !== 'LIGA') {
    throw new ValidationError('Solo una cuenta con rol LIGA puede preparar un cambio de plan');
  }
}

export async function transactionWithRetry<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  code = 'BILLING_CHANGE_CHANGED',
  message = 'El estado del cambio de plan cambió; vuelve a cargarlo',
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 30_000,
      });
    } catch (error) {
      const errorCode = (error as { code?: unknown })?.code;
      if (errorCode === 'P2034' && attempt < 2) continue;
      if (errorCode === 'P2034' || errorCode === 'P2002') throw new AppError(409, message, code);
      throw error;
    }
  }
  throw new AppError(409, message, code);
}

export function classifyBillingChange(
  store: BillingStoreName,
  current: { capacity: number; billingInterval: BillingIntervalName },
  target: { capacity: number; billingInterval: BillingIntervalName },
): { direction: BillingChangeDirection; timing: BillingChangeTiming | null } {
  const direction: BillingChangeDirection = target.capacity > current.capacity
    ? 'UPGRADE'
    : target.capacity < current.capacity ? 'DOWNGRADE' : 'SAME';
  if (direction === 'SAME' && target.billingInterval === current.billingInterval) {
    return { direction, timing: null };
  }
  if (direction === 'UPGRADE') {
    return { direction, timing: target.billingInterval === current.billingInterval || store !== 'GOOGLE' ? 'IMMEDIATE' : 'TWO_STEP' };
  }
  return { direction, timing: 'DEFERRED' };
}

function ineligible(
  store: BillingStoreName,
  target: BillingChangeVariantDto,
  reason: BillingChangePreviewReason,
  current: BillingChangeVariantDto | null = null,
): BillingChangePreviewDto {
  return fingerprintPreview({
    eligible: false,
    reason,
    store,
    current,
    target,
    direction: reason === 'NO_CHANGE' && current ? 'SAME' : null,
    timing: null,
    requiresRenewalSelection: false,
    firstStep: null,
    operationId: null,
    operationStatus: null,
  });
}

function variantId(product: { id?: string }): string {
  if (!product.id) {
    throw new AppError(503, 'La variante de cambio no está disponible', 'BILLING_CHANGE_VARIANT_UNAVAILABLE');
  }
  return product.id;
}

function variantDto(product: {
  id?: string;
  logicalProductId: string;
  billingInterval: BillingIntervalName;
  capacity: number;
  storeProductId: string;
}): BillingChangeVariantDto {
  return {
    variantId: variantId(product),
    logicalProductId: product.logicalProductId,
    billingInterval: product.billingInterval,
    capacity: product.capacity,
    storeProductId: product.storeProductId,
  };
}

type AuthoritativeChange = {
  preview: BillingChangePreviewDto;
  providerSubscriptionChainId: string | null;
  catalogReleaseId: string;
  sourceProduct: BillingCatalogProductInput | null;
  intermediateProduct: BillingCatalogProductInput | null;
  targetProduct: BillingCatalogProductInput;
};

async function authoritativeBillingChange(
  tx: Prisma.TransactionClient,
  accountId: string,
  change: BillingChangePreviewBody,
): Promise<AuthoritativeChange> {
    const catalog = await getActiveBillingCatalog(billingEnvironmentForApp(), tx);
    if (!catalog.available || !catalog.release) {
      throw new AppError(503, 'El catálogo de billing no está disponible', 'BILLING_CATALOG_UNAVAILABLE');
    }
    if (!catalog.purchasesEnabled) {
      throw new AppError(409, 'Las compras están pausadas temporalmente', 'BILLING_PURCHASES_PAUSED');
    }

    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const storeEnvironment = env.APP_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX';
    const paid = await resolvePaidAccessShadowInTransaction(accountId, tx);
    const period = paid.state === 'PAID' ? await tx.billingPeriod.findFirst({
      where: {
        billingAccountId: accountId,
        source: 'STORE',
        effectiveStart: { lte: now },
        effectiveEnd: { gt: now },
        OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: now } }],
      },
      orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
      select: {
        primaryProviderPeriod: {
          select: {
            store: true,
            storeEnvironment: true,
            billingInterval: true,
            subscription: {
              select: {
                providerSubscriptionChainId: true,
              },
            },
          },
        },
      },
    }) : null;
    const fallbackSubscription = period ? null : await tx.billingProviderSubscription.findFirst({
      where: {
        chain: { billingAccountId: accountId },
        storeEnvironment,
        ownershipType: 'PURCHASED',
      },
      orderBy: [{ providerStatusUpdatedAt: 'desc' }, { id: 'desc' }],
      select: { store: true },
    });
    const subscription = period?.primaryProviderPeriod.subscription ?? null;
    const store: BillingStoreName = period?.primaryProviderPeriod.store ?? fallbackSubscription?.store ?? 'GOOGLE';
    const target = catalog.release.products.find((product) =>
      product.store === store
      && product.logicalProductId === change.logicalProductId
      && product.billingInterval === change.billingInterval);
    if (!target) {
      throw new AppError(503, 'La variante de cambio no está disponible', 'BILLING_CHANGE_VARIANT_UNAVAILABLE');
    }
    const unavailable = (preview: BillingChangePreviewDto): AuthoritativeChange => ({
      preview, providerSubscriptionChainId: subscription?.providerSubscriptionChainId ?? null,
      catalogReleaseId: catalog.release!.id, sourceProduct: null, intermediateProduct: null, targetProduct: target,
    });
    if (paid.state === 'BLOCKED') return unavailable(ineligible(store, variantDto(target), 'EVIDENCE_INVALID'));
    if (paid.state === 'LOCAL_GRACE') return unavailable(ineligible(store, variantDto(target), 'LOCAL_GRACE'));
    if (paid.state === 'NONE') return unavailable(ineligible(store, variantDto(target), 'NO_PAID_ACCESS'));
    if (!subscription || !period || period.primaryProviderPeriod.storeEnvironment !== storeEnvironment) {
      return unavailable(ineligible(store, variantDto(target), 'EVIDENCE_INVALID'));
    }
    const currentProduct = catalog.release.products.find((product) =>
      product.store === store
      && product.capacity === paid.capacity
      && product.billingInterval === period.primaryProviderPeriod.billingInterval);
    if (!currentProduct) return unavailable(ineligible(store, variantDto(target), 'CURRENT_VARIANT_UNKNOWN'));

    const current = variantDto(currentProduct);
    const targetVariant = variantDto(target);
    const { direction, timing } = classifyBillingChange(
      store,
      { capacity: paid.capacity, billingInterval: currentProduct.billingInterval },
      { capacity: target.capacity, billingInterval: target.billingInterval },
    );
    if (timing === null) return unavailable(ineligible(store, targetVariant, 'NO_CHANGE', current));

    const assignedCount = paid.assignments.filter(({ divisionId }) => divisionId !== null).length;
    const requiresRenewalSelection = direction === 'DOWNGRADE' && target.capacity < assignedCount;

    let firstStep: BillingChangeVariantDto | null = null;
    let intermediateProduct: BillingCatalogProductInput | null = null;
    if (timing === 'TWO_STEP') {
      const intermediate = catalog.release.products.find((product) =>
        product.store === store
        && product.logicalProductId === target.logicalProductId
        && product.billingInterval === currentProduct.billingInterval);
      if (!intermediate) {
        throw new AppError(503, 'La variante intermedia de cambio no está disponible', 'BILLING_CHANGE_VARIANT_UNAVAILABLE');
      }
      firstStep = variantDto(intermediate);
      intermediateProduct = intermediate;
    }

    if (timing === 'TWO_STEP') {
      const active = await tx.billingChangeOperation.findFirst({
        where: {
          billingAccountId: accountId,
          status: { notIn: TERMINAL_STATUSES },
        },
        select: { id: true },
      });
      if (active) {
        throw new AppError(409, 'Ya hay un cambio de plan en curso para esta suscripción', 'BILLING_CHANGE_IN_PROGRESS');
      }
    }

    const preview = fingerprintPreview({
      eligible: true,
      reason: null,
      store,
      current,
      target: targetVariant,
      direction,
      timing,
      requiresRenewalSelection,
      firstStep,
      operationId: null,
      operationStatus: null,
    });
    return {
      preview,
      providerSubscriptionChainId: subscription.providerSubscriptionChainId,
      catalogReleaseId: catalog.release.id,
      sourceProduct: currentProduct,
      intermediateProduct,
      targetProduct: target,
    };
}

export async function previewBillingChange(
  input: { change: BillingChangePreviewBody; actor: ChangeActor },
  client: PrismaClient = prisma,
): Promise<BillingChangePreviewDto> {
  return transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await ensureBillingAccount(tx, input.actor.userId);
    await acquireBillingAccountLock(tx, account.id);
    return (await authoritativeBillingChange(tx, account.id, input.change)).preview;
  });
}

export interface BillingChangeCheckoutAttemptDto {
  id: string;
  status: 'PREPARED' | 'STORE_PENDING' | 'VERIFICATION_PENDING' | 'CANCEL_REPORTED' | 'VERIFYING' | 'VERIFIED' | 'CANCELED' | 'REJECTED' | 'OWNERSHIP_CONFLICT' | 'ABANDONED';
  purpose: 'PRODUCT_CHANGE_FIRST_STEP' | 'PRODUCT_CHANGE_FINAL_STEP';
  version: number;
  logicalProductId: string;
  billingInterval: BillingIntervalName;
  targetCapacity: number;
  offeringId: string;
  packageId: string;
  productIdentifier: string;
  basePlanId: string;
  startedAt: Date;
  nextVerificationAt: Date | null;
}

export interface BillingChangeConfirmResult {
  operation: BillingChangeOperationDto;
  attempt: BillingChangeCheckoutAttemptDto;
  instruction: {
    step: 'FIRST' | 'FINAL';
    replacementMode: 'CHARGE_PRORATED_PRICE' | 'DEFERRED';
    sourceVariant: BillingChangeVariantDto;
    targetVariant: BillingChangeVariantDto;
  };
}

const changeAttemptProjection = {
  id: true, status: true, purpose: true, version: true,
  logicalProductIdSnapshot: true, billingIntervalSnapshot: true, targetCapacitySnapshot: true,
  offeringIdSnapshot: true, packageIdSnapshot: true, storeProductIdSnapshot: true, basePlanIdSnapshot: true,
  revenueCatProductIdentifierSnapshot: true,
  startedAt: true, nextVerificationAt: true,
} satisfies Prisma.BillingCheckoutAttemptSelect;

function changeAttemptDto(attempt: Prisma.BillingCheckoutAttemptGetPayload<{ select: typeof changeAttemptProjection }>): BillingChangeCheckoutAttemptDto {
  if ((attempt.purpose !== 'PRODUCT_CHANGE_FIRST_STEP' && attempt.purpose !== 'PRODUCT_CHANGE_FINAL_STEP')
    || !attempt.basePlanIdSnapshot || !attempt.revenueCatProductIdentifierSnapshot) {
    throw new AppError(500, 'El intento de cambio es inválido', 'BILLING_CHANGE_ATTEMPT_INVALID');
  }
  return {
    id: attempt.id, status: attempt.status, purpose: attempt.purpose, version: attempt.version,
    logicalProductId: attempt.logicalProductIdSnapshot,
    billingInterval: attempt.billingIntervalSnapshot,
    targetCapacity: attempt.targetCapacitySnapshot,
    offeringId: attempt.offeringIdSnapshot,
    packageId: attempt.packageIdSnapshot,
    productIdentifier: attempt.revenueCatProductIdentifierSnapshot,
    basePlanId: attempt.basePlanIdSnapshot,
    startedAt: attempt.startedAt, nextVerificationAt: attempt.nextVerificationAt,
  };
}

function changeAttemptData(
  product: BillingCatalogProductInput,
  catalogReleaseId: string,
  purpose: 'PRODUCT_CHANGE_FIRST_STEP' | 'PRODUCT_CHANGE_FINAL_STEP',
  input: { accountId: string; operationId: string; idempotencyKey: string; requestFingerprint: string; now: Date; verificationAt: Date },
) {
  if (!product.id || product.store !== 'GOOGLE' || !product.basePlanId) {
    throw new AppError(503, 'La variante de Google Play no está disponible', 'BILLING_CHANGE_VARIANT_UNAVAILABLE');
  }
  return {
    billingAccountId: input.accountId, changeOperationId: input.operationId, purchaseSelectionId: null,
    purpose, store: 'GOOGLE' as const, catalogReleaseIdSnapshot: catalogReleaseId,
    logicalProductIdSnapshot: product.logicalProductId, billingIntervalSnapshot: product.billingInterval,
    targetCapacitySnapshot: product.capacity, offeringIdSnapshot: product.revenueCatOfferingId,
    packageIdSnapshot: product.revenueCatPackageId, storeProductIdSnapshot: product.storeProductId,
    basePlanIdSnapshot: product.basePlanId,
    revenueCatProductIdentifierSnapshot: product.revenueCatProductIdentifier,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint, startedAt: input.now, nextVerificationAt: input.verificationAt,
  };
}

export async function confirmBillingChange(
  input: { confirm: BillingChangeConfirmBody; idempotencyKey: string; actor: ChangeActor },
  client: PrismaClient = prisma,
): Promise<BillingChangeConfirmResult> {
  const requestFingerprint = fingerprint(input.confirm);
  const result: BillingChangeConfirmResult = await transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await ensureBillingAccount(tx, input.actor.userId);
    await acquireBillingAccountLock(tx, account.id);
    const prior = await tx.billingChangeOperation.findUnique({
      where: { billingAccountId_idempotencyKey: { billingAccountId: account.id, idempotencyKey: input.idempotencyKey } },
      select: {
        id: true, status: true, version: true, requestFingerprint: true,
        sourceVariant: { select: { id: true, logicalProductId: true, billingInterval: true, capacity: true, storeProductId: true } },
        intermediateVariant: { select: { id: true, logicalProductId: true, billingInterval: true, capacity: true, storeProductId: true } },
        checkoutAttempts: {
          where: { purpose: 'PRODUCT_CHANGE_FIRST_STEP' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1,
          select: changeAttemptProjection,
        },
      },
    });
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint || !prior.checkoutAttempts[0]) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      return {
        operation: { id: prior.id, status: prior.status, version: prior.version },
        attempt: changeAttemptDto(prior.checkoutAttempts[0]),
        instruction: {
          step: 'FIRST', replacementMode: 'CHARGE_PRORATED_PRICE',
          sourceVariant: variantDto(prior.sourceVariant), targetVariant: variantDto(prior.intermediateVariant),
        },
      };
    }
    const requestedTarget = await tx.billingProductCatalog.findUnique({
      where: { id: input.confirm.targetVariantId },
      select: { logicalProductId: true, billingInterval: true },
    });
    if (!requestedTarget) throw new AppError(409, 'La vista previa ya no es válida', 'BILLING_CHANGE_PREVIEW_STALE');
    const authoritative = await authoritativeBillingChange(tx, account.id, requestedTarget);
    const { preview } = authoritative;
    if (!preview.eligible || preview.store !== 'GOOGLE' || preview.timing !== 'TWO_STEP'
      || preview.direction !== 'UPGRADE' || !authoritative.sourceProduct || !authoritative.intermediateProduct
      || !authoritative.providerSubscriptionChainId) {
      throw new AppError(422, 'Solo está soportado el cambio explícito Google de dos pasos', 'BILLING_CHANGE_UNSUPPORTED');
    }
    if (preview.target.variantId !== input.confirm.targetVariantId
      || preview.current?.variantId !== input.confirm.expectedSourceVariantId
      || preview.previewFingerprint !== input.confirm.previewFingerprint) {
      throw new AppError(409, 'La vista previa cambió; vuelve a confirmarla', 'BILLING_CHANGE_PREVIEW_STALE');
    }
    const [{ now, verificationAt }] = await tx.$queryRaw<Array<{ now: Date; verificationAt: Date }>>`
      SELECT NOW() AS now, NOW() + INTERVAL '5 minutes' AS "verificationAt"
    `;
    const operation = await tx.billingChangeOperation.create({
      data: {
        billingAccountId: account.id, providerSubscriptionChainId: authoritative.providerSubscriptionChainId,
        store: 'GOOGLE', idempotencyKey: input.idempotencyKey, requestFingerprint,
        type: 'GOOGLE_TWO_STEP', status: 'FIRST_PURCHASE_PENDING',
        sourceVariantId: variantId(authoritative.sourceProduct),
        intermediateVariantId: variantId(authoritative.intermediateProduct),
        targetVariantId: variantId(authoritative.targetProduct),
      },
      select: { id: true, status: true, version: true },
    });
    const attempt = await tx.billingCheckoutAttempt.create({
      data: changeAttemptData(authoritative.intermediateProduct, authoritative.catalogReleaseId, 'PRODUCT_CHANGE_FIRST_STEP', {
        accountId: account.id, operationId: operation.id, idempotencyKey: input.idempotencyKey,
        requestFingerprint, now, verificationAt,
      }),
      select: changeAttemptProjection,
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHANGE_OPERATION_CONFIRMED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingChangeOperation', targetId: operation.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: {
          store: 'GOOGLE', type: 'GOOGLE_TWO_STEP', status: operation.status,
          sourceVariantId: variantId(authoritative.sourceProduct),
          intermediateVariantId: variantId(authoritative.intermediateProduct),
          targetVariantId: variantId(authoritative.targetProduct),
        } satisfies Prisma.InputJsonObject,
      },
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_ATTEMPT_STARTED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingCheckoutAttempt', targetId: attempt.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: {
          purpose: 'PRODUCT_CHANGE_FIRST_STEP', changeOperationId: operation.id,
          logicalProductId: authoritative.intermediateProduct.logicalProductId,
          billingInterval: authoritative.intermediateProduct.billingInterval,
          targetCapacity: authoritative.intermediateProduct.capacity,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return {
      operation,
      attempt: changeAttemptDto(attempt),
      instruction: {
        step: 'FIRST', replacementMode: 'CHARGE_PRORATED_PRICE',
        sourceVariant: preview.current, targetVariant: preview.firstStep,
      },
    } as BillingChangeConfirmResult;
  }, 'BILLING_CHANGE_OPERATION_CHANGED', 'La operación de cambio cambió; vuelve a cargarla');
  if (env.BILLING_REVENUECAT_ENABLED && result.attempt.nextVerificationAt) {
    signalBackgroundJob('billing-checkout', result.attempt.nextVerificationAt);
  }
  return result;
}

export async function confirmBillingChangeFinalStep(
  input: { operation: BillingChangeOperationParams; confirm: BillingChangeFinalStepConfirmBody; idempotencyKey: string; actor: ChangeActor },
  client: PrismaClient = prisma,
): Promise<BillingChangeConfirmResult> {
  const requestFingerprint = fingerprint({ operationId: input.operation.operationId, ...input.confirm });
  const result: BillingChangeConfirmResult = await transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await ensureBillingAccount(tx, input.actor.userId);
    await acquireBillingAccountLock(tx, account.id);
    const replay = await tx.billingCheckoutAttempt.findUnique({
      where: { billingAccountId_idempotencyKey: { billingAccountId: account.id, idempotencyKey: input.idempotencyKey } },
      select: {
        requestFingerprint: true, changeOperationId: true, ...changeAttemptProjection,
        changeOperation: {
          select: {
            id: true, status: true, version: true,
            intermediateVariant: { select: { id: true, logicalProductId: true, billingInterval: true, capacity: true, storeProductId: true } },
            targetVariant: { select: { id: true, logicalProductId: true, billingInterval: true, capacity: true, storeProductId: true } },
          },
        },
      },
    });
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint || replay.changeOperationId !== input.operation.operationId
        || replay.purpose !== 'PRODUCT_CHANGE_FINAL_STEP' || !replay.changeOperation) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      return {
        operation: { id: replay.changeOperation.id, status: replay.changeOperation.status, version: replay.changeOperation.version },
        attempt: changeAttemptDto(replay),
        instruction: {
          step: 'FINAL', replacementMode: 'DEFERRED',
          sourceVariant: variantDto(replay.changeOperation.intermediateVariant),
          targetVariant: variantDto(replay.changeOperation.targetVariant),
        },
      };
    }
    const operation = await tx.billingChangeOperation.findFirst({
      where: { id: input.operation.operationId, billingAccountId: account.id },
      select: {
        id: true, status: true, version: true,
        intermediateVariant: true, targetVariant: true,
      },
    });
    if (!operation) throw new NotFoundError('Operación de cambio');
    if (operation.status !== 'SECOND_STEP_PENDING' || operation.version !== input.confirm.expectedVersion) {
      throw new AppError(409, 'La operación de cambio cambió; vuelve a cargarla', 'BILLING_CHANGE_OPERATION_CHANGED');
    }
    const [{ now, verificationAt }] = await tx.$queryRaw<Array<{ now: Date; verificationAt: Date }>>`
      SELECT NOW() AS now, NOW() + INTERVAL '5 minutes' AS "verificationAt"
    `;
    const attempt = await tx.billingCheckoutAttempt.create({
      data: changeAttemptData(operation.targetVariant, operation.targetVariant.catalogReleaseId, 'PRODUCT_CHANGE_FINAL_STEP', {
        accountId: account.id, operationId: operation.id, idempotencyKey: input.idempotencyKey,
        requestFingerprint, now, verificationAt,
      }),
      select: changeAttemptProjection,
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_ATTEMPT_STARTED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingCheckoutAttempt', targetId: attempt.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: {
          purpose: 'PRODUCT_CHANGE_FINAL_STEP', changeOperationId: operation.id,
          logicalProductId: operation.targetVariant.logicalProductId,
          billingInterval: operation.targetVariant.billingInterval,
          targetCapacity: operation.targetVariant.capacity,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return {
      operation: { id: operation.id, status: operation.status, version: operation.version },
      attempt: changeAttemptDto(attempt),
      instruction: {
        step: 'FINAL', replacementMode: 'DEFERRED',
        sourceVariant: variantDto(operation.intermediateVariant), targetVariant: variantDto(operation.targetVariant),
      },
    };
  }, 'BILLING_CHANGE_OPERATION_CHANGED', 'La operación de cambio cambió; vuelve a cargarla');
  if (env.BILLING_REVENUECAT_ENABLED && result.attempt.nextVerificationAt) {
    signalBackgroundJob('billing-checkout', result.attempt.nextVerificationAt);
  }
  return result;
}

export async function abandonBillingChangeOperation(
  input: { operation: BillingChangeOperationParams; idempotencyKey: string; actor: ChangeActor },
  client: PrismaClient = prisma,
): Promise<BillingChangeOperationDto> {
  return transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await ensureBillingAccount(tx, input.actor.userId);
    await acquireBillingAccountLock(tx, account.id);

    const requestFingerprint = fingerprint({ operationId: input.operation.operationId, status: 'ABANDONED' });
    const priorAbandon = await tx.billingChangeOperation.findFirst({
      where: { billingAccountId: account.id, abandonIdempotencyKey: input.idempotencyKey },
      select: {
        id: true, status: true, version: true,
        abandonRequestFingerprint: true,
      },
    });
    if (priorAbandon) {
      if (priorAbandon.id !== input.operation.operationId
        || priorAbandon.abandonRequestFingerprint !== requestFingerprint) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      return { id: priorAbandon.id, status: priorAbandon.status, version: priorAbandon.version };
    }

    const operation = await tx.billingChangeOperation.findFirst({
      where: { id: input.operation.operationId, billingAccountId: account.id },
      select: {
        id: true, status: true, version: true,
        abandonIdempotencyKey: true, abandonRequestFingerprint: true,
      },
    });
    if (!operation) throw new NotFoundError('Operación de cambio');
    if (operation.status === 'ABANDONED') {
      throw new ConflictError('La operación ya fue abandonada con otra Idempotency-Key');
    }
    if (operation.status !== 'SECOND_STEP_PENDING') {
      throw new AppError(409, 'La operación de cambio ya no puede abandonarse', 'BILLING_CHANGE_OPERATION_NOT_ABANDONABLE');
    }
    const activeFinalAttempt = await tx.billingCheckoutAttempt.findFirst({
      where: {
        changeOperationId: operation.id,
        purpose: 'PRODUCT_CHANGE_FINAL_STEP',
        status: { notIn: ['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'] },
      },
      select: { id: true },
    });
    if (activeFinalAttempt) {
      throw new AppError(409, 'El paso final todavía se está verificando', 'BILLING_CHANGE_OPERATION_NOT_ABANDONABLE');
    }

    const updated = await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: {
        status: 'ABANDONED',
        abandonIdempotencyKey: input.idempotencyKey,
        abandonRequestFingerprint: requestFingerprint,
        lastErrorCode: 'USER_ABANDONED',
        version: { increment: 1 },
      },
      select: { id: true, status: true, version: true },
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHANGE_OPERATION_ABANDONED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingChangeOperation', targetId: operation.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: {
          previousStatus: operation.status,
          version: updated.version,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return { id: updated.id, status: updated.status, version: updated.version };
  }, 'BILLING_CHANGE_OPERATION_CHANGED', 'La operación de cambio cambió; vuelve a cargarla');
}

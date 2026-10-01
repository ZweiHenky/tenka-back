import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { Prisma, type BillingCheckoutAttemptStatus, type PrismaClient } from '../../generated/prisma/client';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { assertCanonicalBillingIdentity } from './canonicalIdentity';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import type { BillingCheckoutOutcomeInput, BillingCheckoutStartInput } from './checkoutValidator';
import { reconcilePeriodicCandidateNow } from './periodicReconciliationWorker';
import { ensureBillingAccount } from './service';
import { signalBackgroundJob } from '../../workers/jobSignals';

interface CheckoutActor { userId: string; requestId: string }

const TERMINAL_STATUSES: BillingCheckoutAttemptStatus[] = [
  'VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED',
];

const checkoutProjection = {
  id: true,
  purchaseSelectionId: true,
  store: true,
  logicalProductIdSnapshot: true,
  billingIntervalSnapshot: true,
  targetCapacitySnapshot: true,
  offeringIdSnapshot: true,
  packageIdSnapshot: true,
  storeProductIdSnapshot: true,
  basePlanIdSnapshot: true,
  status: true,
  version: true,
  startedAt: true,
  nextVerificationAt: true,
  terminalAt: true,
  lastErrorCode: true,
} satisfies Prisma.BillingCheckoutAttemptSelect;

type CheckoutProjection = Prisma.BillingCheckoutAttemptGetPayload<{ select: typeof checkoutProjection }>;

export interface BillingCheckoutAttemptDto {
  id: string;
  purchaseSelectionId: string;
  store: 'GOOGLE';
  logicalProductId: string;
  billingInterval: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  targetCapacity: number;
  offeringId: string;
  packageId: string;
  productIdentifier: string;
  basePlanId: string;
  status: BillingCheckoutAttemptStatus;
  version: number;
  startedAt: Date;
  nextVerificationAt: Date | null;
  terminalAt: Date | null;
  lastErrorCode: string | null;
}

export interface BillingCheckoutSyncResult {
  status: 'SYNCHRONIZED' | 'PENDING';
  reason?: string;
  attempt: BillingCheckoutAttemptDto | null;
}

function dto(attempt: CheckoutProjection): BillingCheckoutAttemptDto {
  if (attempt.store !== 'GOOGLE' || !attempt.basePlanIdSnapshot) {
    throw new Error('invalid_google_checkout_attempt_projection');
  }
  return {
    id: attempt.id,
    purchaseSelectionId: attempt.purchaseSelectionId,
    store: 'GOOGLE',
    logicalProductId: attempt.logicalProductIdSnapshot,
    billingInterval: attempt.billingIntervalSnapshot,
    targetCapacity: attempt.targetCapacitySnapshot,
    offeringId: attempt.offeringIdSnapshot,
    packageId: attempt.packageIdSnapshot,
    productIdentifier: `${attempt.storeProductIdSnapshot}:${attempt.basePlanIdSnapshot}`,
    basePlanId: attempt.basePlanIdSnapshot,
    status: attempt.status,
    version: attempt.version,
    startedAt: attempt.startedAt,
    nextVerificationAt: attempt.nextVerificationAt,
    terminalAt: attempt.terminalAt,
    lastErrorCode: attempt.lastErrorCode,
  };
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function assertLeagueActor(client: Pick<Prisma.TransactionClient, 'user'>, userId: string): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');
  if (user.rol !== 'LIGA') throw new ValidationError('Solo una cuenta con rol LIGA puede iniciar una compra');
}

async function transactionWithRetry<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'P2034' && attempt < 2) continue;
      if (code === 'P2034' || code === 'P2002') {
        throw new AppError(409, 'El estado del checkout cambió; vuelve a cargarlo', 'BILLING_CHECKOUT_CHANGED');
      }
      throw error;
    }
  }
  throw new AppError(409, 'El estado del checkout cambió; vuelve a cargarlo', 'BILLING_CHECKOUT_CHANGED');
}

export async function startBillingCheckout(input: {
  checkout: BillingCheckoutStartInput;
  idempotencyKey: string;
  actor: CheckoutActor;
}, client: PrismaClient = prisma): Promise<BillingCheckoutAttemptDto> {
  const requestFingerprint = fingerprint(input.checkout);
  const result = await transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await ensureBillingAccount(tx, input.actor.userId);
    await assertLeagueActor(tx, input.actor.userId);

    const prior = await tx.billingCheckoutAttempt.findUnique({
      where: { billingAccountId_idempotencyKey: { billingAccountId: account.id, idempotencyKey: input.idempotencyKey } },
      select: { requestFingerprint: true, ...checkoutProjection },
    });
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      return dto(prior);
    }

    const catalog = await getActiveBillingCatalog(billingEnvironmentForApp(), tx);
    if (!catalog.available || !catalog.release) {
      throw new AppError(503, 'El catálogo de billing no está disponible', 'BILLING_CATALOG_UNAVAILABLE');
    }
    if (!catalog.purchasesEnabled) {
      throw new AppError(409, 'Las compras están pausadas temporalmente', 'BILLING_PURCHASES_PAUSED');
    }
    const selection = await tx.billingPurchaseSelection.findFirst({
      where: { id: input.checkout.purchaseSelectionId, billingAccountId: account.id },
      select: {
        id: true, status: true, version: true, logicalProductId: true,
        billingInterval: true, targetCapacity: true,
      },
    });
    if (!selection) throw new NotFoundError('Selección de compra');
    if (selection.status !== 'DRAFT') {
      throw new AppError(409, 'La selección no está disponible para iniciar checkout', 'BILLING_SELECTION_LOCKED');
    }
    if (selection.version !== input.checkout.expectedVersion) {
      throw new AppError(409, 'La selección cambió; vuelve a cargar su estado', 'BILLING_SELECTION_CHANGED');
    }
    const variant = catalog.release.products.find((product) =>
      product.store === 'GOOGLE'
      && product.logicalProductId === selection.logicalProductId
      && product.billingInterval === selection.billingInterval
      && product.capacity === selection.targetCapacity);
    if (!variant || !variant.basePlanId) {
      throw new AppError(503, 'La variante de Google Play no está disponible', 'BILLING_CHECKOUT_VARIANT_UNAVAILABLE');
    }
    const [{ now, verificationAt }] = await tx.$queryRaw<Array<{ now: Date; verificationAt: Date }>>`
      SELECT NOW() AS now, NOW() + INTERVAL '5 minutes' AS "verificationAt"
    `;
    const attempt = await tx.billingCheckoutAttempt.create({
      data: {
        billingAccountId: account.id,
        purchaseSelectionId: selection.id,
        store: 'GOOGLE',
        catalogReleaseIdSnapshot: catalog.release.id,
        logicalProductIdSnapshot: variant.logicalProductId,
        billingIntervalSnapshot: variant.billingInterval,
        targetCapacitySnapshot: variant.capacity,
        offeringIdSnapshot: variant.revenueCatOfferingId,
        packageIdSnapshot: variant.revenueCatPackageId,
        storeProductIdSnapshot: variant.storeProductId,
        basePlanIdSnapshot: variant.basePlanId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        startedAt: now,
        nextVerificationAt: verificationAt,
      },
      select: checkoutProjection,
    });
    const locked = await tx.billingPurchaseSelection.updateMany({
      where: { id: selection.id, status: 'DRAFT', version: input.checkout.expectedVersion },
      data: {
        status: 'LOCKED', lockedAt: now, checkoutAttemptId: attempt.id,
        version: { increment: 1 },
      },
    });
    if (locked.count !== 1) {
      throw new AppError(409, 'La selección cambió durante el inicio de checkout', 'BILLING_SELECTION_CHANGED');
    }
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_ATTEMPT_STARTED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingCheckoutAttempt', targetId: attempt.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: {
          store: 'GOOGLE', logicalProductId: variant.logicalProductId,
          billingInterval: variant.billingInterval, targetCapacity: variant.capacity,
          selectionVersion: selection.version + 1,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return dto(attempt);
  });
  if (env.BILLING_REVENUECAT_ENABLED && result.nextVerificationAt) {
    signalBackgroundJob('billing-checkout', result.nextVerificationAt);
  }
  return result;
}

export async function getActiveBillingCheckout(
  userId: string,
  client: PrismaClient = prisma,
): Promise<BillingCheckoutAttemptDto | null> {
  await assertLeagueActor(client, userId);
  const account = await client.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (!account) return null;
  const attempt = await client.billingCheckoutAttempt.findFirst({
    where: { billingAccountId: account.id, status: { notIn: TERMINAL_STATUSES } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: checkoutProjection,
  });
  return attempt ? dto(attempt) : null;
}

export async function reportBillingCheckoutOutcome(input: {
  attemptId: string;
  outcome: BillingCheckoutOutcomeInput;
  idempotencyKey: string;
  actor: CheckoutActor;
}, client: PrismaClient = prisma): Promise<BillingCheckoutAttemptDto> {
  const requestFingerprint = fingerprint(input.outcome);
  const result = await transactionWithRetry(client, async (tx) => {
    await configureRawQuerySchema(tx);
    await assertLeagueActor(tx, input.actor.userId);
    const account = await tx.billingAccount.findUnique({ where: { userId: input.actor.userId }, select: { id: true } });
    if (!account) throw new NotFoundError('Cuenta de billing');
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-account:${account.id}`);
    const attempt = await tx.billingCheckoutAttempt.findFirst({
      where: { id: input.attemptId, billingAccountId: account.id },
      select: { requestFingerprint: true, ...checkoutProjection },
    });
    if (!attempt) throw new NotFoundError('Intento de checkout');
    const replay = await tx.billingAuditLog.findFirst({
      where: {
        action: 'BILLING_CHECKOUT_OUTCOME_REPORTED', actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingCheckoutAttempt', targetId: attempt.id, idempotencyKey: input.idempotencyKey,
      },
      select: { requestFingerprint: true },
    });
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otro resultado');
      }
      return dto(attempt);
    }
    if (TERMINAL_STATUSES.includes(attempt.status)) {
      throw new AppError(409, 'El intento de checkout ya terminó', 'BILLING_CHECKOUT_TERMINAL');
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const status: BillingCheckoutAttemptStatus = input.outcome.outcome === 'PENDING'
      ? 'STORE_PENDING'
      : input.outcome.outcome === 'CANCELED'
        ? 'CANCEL_REPORTED'
        : 'VERIFICATION_PENDING';
    const updated = await tx.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status, sdkOutcomeAt: now, nextVerificationAt: now,
        lastErrorCode: input.outcome.outcome === 'OWNERSHIP_CONFLICT' ? 'sdk_ownership_conflict' : null,
        version: { increment: 1 },
      },
      select: checkoutProjection,
    });
    if (status !== 'CANCEL_REPORTED') {
      await tx.billingVerification.upsert({
        where: { checkoutAttemptId: attempt.id },
        create: {
          billingAccountId: account.id, checkoutAttemptId: attempt.id, store: 'GOOGLE',
          idempotencyKey: input.idempotencyKey, requestFingerprint, requestedAt: now,
        },
        update: {},
      });
      await tx.billingAuditLog.create({
        data: {
          action: 'BILLING_VERIFICATION_REQUESTED', actorType: 'USER',
          actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
          targetType: 'BillingCheckoutAttempt', targetId: attempt.id,
          requestId: input.actor.requestId,
          metadataRedacted: { store: 'GOOGLE' },
        },
      });
    }
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_OUTCOME_REPORTED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingCheckoutAttempt', targetId: attempt.id,
        requestId: input.actor.requestId, idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: { outcome: input.outcome.outcome, resultingStatus: status },
      },
    });
    return dto(updated);
  });
  if (env.BILLING_REVENUECAT_ENABLED) signalBackgroundJob('billing-checkout', result.nextVerificationAt ?? new Date());
  return result;
}

export async function syncBillingCheckout(input: {
  userId: string;
  requestId: string;
  checkoutAttemptId?: string;
}, client: PrismaClient = prisma): Promise<BillingCheckoutSyncResult> {
  await assertLeagueActor(client, input.userId);
  const account = await client.billingAccount.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!account) throw new NotFoundError('Cuenta de billing');
  await assertCanonicalBillingIdentity(account.id, client);
  if (!env.BILLING_REVENUECAT_ENABLED) {
    throw new AppError(503, 'La sincronización de billing no está disponible', 'BILLING_REVENUECAT_DISABLED');
  }
  if (input.checkoutAttemptId) {
    const owned = await client.billingCheckoutAttempt.findFirst({
      where: { id: input.checkoutAttemptId, billingAccountId: account.id }, select: { id: true },
    });
    if (!owned) throw new NotFoundError('Intento de checkout');
  }
  const outcome = await reconcilePeriodicCandidateNow(account.id, `billing-sync:${randomUUID()}`, client);
  const attempt = input.checkoutAttemptId
    ? await client.billingCheckoutAttempt.findUnique({ where: { id: input.checkoutAttemptId }, select: checkoutProjection })
    : await client.billingCheckoutAttempt.findFirst({
      where: { billingAccountId: account.id }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], select: checkoutProjection,
    });
  const projectedAttempt = attempt ? dto(attempt) : null;
  if (attempt && TERMINAL_STATUSES.includes(attempt.status)) {
    return { status: 'SYNCHRONIZED', attempt: projectedAttempt };
  }
  if (outcome.kind === 'SUCCESS') {
    return attempt
      ? { status: 'PENDING', reason: 'checkout_pending', attempt: projectedAttempt }
      : { status: 'SYNCHRONIZED', attempt: null };
  }
  return { status: 'PENDING', reason: outcome.kind.toLowerCase(), attempt: projectedAttempt };
}

export const checkoutServiceInternals = { fingerprint, dto, TERMINAL_STATUSES };

import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import type { BillingInterval, Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { markMigrationPurchasedInTransaction } from './migrationLifecycleService';
import { billingEvidenceHash } from './providerEvidence';
import { ownershipConflict, persistNormalizedGoogleLedgerInTransaction } from './providerLedger';
import type { NormalizedGoogleCustomer } from './providerNormalizer';
import { acquireBillingAccountLock } from './service';
import { evaluateStoreEffectiveAccess } from './effectiveAccessEvaluator';
import {
  createPaidExpirationFreeGrantInTransaction,
  expireLocalGraceInTransaction,
  recoverLocalGraceInTransaction,
  startLocalGraceInTransaction,
  terminateLocalGraceInTransaction,
} from './localGraceService';

type LedgerCounts = { subscriptions: number; transactionsCreated: number; periodsCreated: number };
type RolloverAssignment = {
  id: string;
  assignedAt: Date;
  divisionId: string | null;
  divisionIdSnapshot: string;
  divisionNameSnapshot: string;
  leagueIdSnapshot: string;
  leagueNameSnapshot: string;
  ownerUserIdSnapshot: string;
  slotNumber: number;
};

function planRolloverAssignments(
  assignments: RolloverAssignment[],
  previousCapacity: number,
  targetCapacity: number,
) {
  const eligible = assignments.filter(({ divisionId }) => divisionId !== null);
  if (targetCapacity >= previousCapacity) {
    return eligible
      .filter(({ slotNumber }) => slotNumber <= targetCapacity)
      .map((assignment) => ({ ...assignment, assignmentSource: 'PERIOD_ROLLOVER' as const }));
  }
  return eligible
    .sort((left, right) => left.assignedAt.getTime() - right.assignedAt.getTime() || left.id.localeCompare(right.id))
    .slice(0, targetCapacity)
    .map((assignment, index) => ({ ...assignment, slotNumber: index + 1, assignmentSource: 'RENEWAL_FALLBACK' as const }));
}

function terminalPeriodReason(reason: string | null | undefined) {
  switch (reason) {
    case 'REFUND': return 'REFUND' as const;
    case 'REVOCATION': return 'REVOCATION' as const;
    case 'CHARGEBACK': return 'CHARGEBACK' as const;
    case 'FRAUD': return 'FRAUD' as const;
    default: return null;
  }
}

function isPurchaseTransition(input: {
  hasCurrentPeriod: boolean;
  predecessorAccessEnd: Date | null;
  providerPeriodStart: Date;
  hasActiveFreeGrant: boolean;
}) {
  if (input.hasCurrentPeriod) return false;
  if (!input.predecessorAccessEnd || input.hasActiveFreeGrant) return true;
  return input.providerPeriodStart > input.predecessorAccessEnd;
}

  function audit(
  tx: Prisma.TransactionClient,
  action: 'BILLING_PERIOD_MATERIALIZED' | 'BILLING_PERIOD_SUPERSEDED'
    | 'BILLING_PERIOD_ENDED' | 'BILLING_CAPACITY_GRANTED' | 'BILLING_DIVISION_ASSIGNED'
    | 'BILLING_MATERIALIZATION_BLOCKED' | 'BILLING_PURCHASE_SELECTION_UPDATED'
    | 'BILLING_CHECKOUT_ATTEMPT_COMPLETED' | 'BILLING_VERIFICATION_COMPLETED',
  targetType: string,
  targetId: string,
  metadataRedacted: Prisma.InputJsonObject,
) {
  return tx.billingAuditLog.create({
    data: {
      action,
      actorType: 'SYSTEM',
      actorUserIdSnapshot: 'billing-reconciliation',
      targetType,
      targetId,
      requestId: randomUUID(),
      metadataRedacted,
    },
  });
}

async function createInitialAssignment(
  tx: Prisma.TransactionClient,
  input: {
    billingPeriodId: string;
    billingAccountId: string;
    ownerUserId: string;
    divisionId: string;
    slotNumber: number;
    assignedAt: Date;
    assignmentSource: 'PURCHASE_SELECTION' | 'PURCHASE_FALLBACK';
  },
): Promise<boolean> {
  const division = await tx.division.findFirst({
    where: { id: input.divisionId, liga: { userId: input.ownerUserId } },
    select: { id: true, nombre: true, liga: { select: { id: true, nombre: true } } },
  });
  if (!division) return false;
  const assignment = await tx.divisionCapacityAssignment.create({
    data: {
      billingPeriodId: input.billingPeriodId,
      slotNumber: input.slotNumber,
      divisionId: division.id,
      divisionIdSnapshot: division.id,
      divisionNameSnapshot: division.nombre,
      leagueIdSnapshot: division.liga.id,
      leagueNameSnapshot: division.liga.nombre,
      ownerUserIdSnapshot: input.ownerUserId,
      assignedAt: input.assignedAt,
      assignmentSource: input.assignmentSource,
    },
    select: { id: true },
  });
  await audit(tx, 'BILLING_DIVISION_ASSIGNED', 'DivisionCapacityAssignment', assignment.id, {
    slotNumber: input.slotNumber,
    assignmentSource: input.assignmentSource,
  });
  return true;
}

async function finalizePurchaseSelection(
  tx: Prisma.TransactionClient,
  input: {
    selection: { id: string; version: number; checkoutAttemptId: string };
    billingPeriodId: string;
    assignmentCount: number;
    capacity: number;
    providerSubscriptionChainId: string;
    providerTransactionId: string | null;
    completedAt: Date;
    historicalRecovery?: boolean;
  },
) {
  const applied = await tx.billingPurchaseSelection.updateMany({
    where: {
      id: input.selection.id, status: 'LOCKED', version: input.selection.version,
      checkoutAttemptId: input.selection.checkoutAttemptId, consumedByPeriodId: null,
    },
    data: { status: 'APPLIED', consumedByPeriodId: input.billingPeriodId, version: { increment: 1 } },
  });
  if (applied.count !== 1) {
    throw new AppError(409, 'La selección inicial cambió durante la materialización', 'BILLING_SELECTION_CHANGED');
  }
  await audit(tx, 'BILLING_PURCHASE_SELECTION_UPDATED', 'BillingPurchaseSelection', input.selection.id, {
    resultingStatus: 'APPLIED', resultingVersion: input.selection.version + 1,
    assignmentCount: input.assignmentCount, capacity: input.capacity,
    historicalRecovery: input.historicalRecovery ?? false,
  });
  const verification = await tx.billingVerification.findUnique({
    where: { checkoutAttemptId: input.selection.checkoutAttemptId },
    select: { id: true, status: true, attemptCount: true },
  });
  if (verification?.status === 'PENDING') {
    await tx.billingVerification.update({
      where: { id: verification.id },
      data: {
        status: 'VERIFIED', providerSubscriptionChainId: input.providerSubscriptionChainId,
        providerTransactionId: input.providerTransactionId, lastAttemptAt: input.completedAt,
        verifiedAt: input.completedAt, attemptCount: Math.max(1, verification.attemptCount), lastErrorCode: null,
      },
    });
    await audit(tx, 'BILLING_VERIFICATION_COMPLETED', 'BillingVerification', verification.id, {
      resultingStatus: 'VERIFIED', attemptCount: Math.max(1, verification.attemptCount),
      historicalRecovery: input.historicalRecovery ?? false,
    });
  }
  const attempt = await tx.billingCheckoutAttempt.findUnique({
    where: { id: input.selection.checkoutAttemptId }, select: { id: true, status: true, version: true },
  });
  if (attempt && !['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'].includes(attempt.status)) {
    await tx.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'VERIFIED', terminalAt: input.completedAt, nextVerificationAt: null,
        leaseUntil: null, lockedBy: null, lastVerificationAt: input.completedAt,
        verificationAttempts: { increment: 1 }, lastErrorCode: null, version: { increment: 1 },
      },
    });
    await audit(tx, 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', 'BillingCheckoutAttempt', attempt.id, {
      resultingStatus: 'VERIFIED', resultingVersion: attempt.version + 1,
      historicalRecovery: input.historicalRecovery ?? false,
    });
  }
}

async function applyInitialPurchaseSelection(
  tx: Prisma.TransactionClient,
  input: {
    billingAccountId: string;
    ownerUserId: string;
    billingPeriodId: string;
    logicalProductId: string;
    billingInterval: BillingInterval;
    capacity: number;
    assignedAt: Date;
    providerSubscriptionChainId: string;
    providerTransactionId: string | null;
  },
): Promise<{ assignmentCount: number; usedSelection: boolean }> {
  const selection = await tx.billingPurchaseSelection.findFirst({
    where: {
      billingAccountId: input.billingAccountId,
      status: 'LOCKED',
      logicalProductId: input.logicalProductId,
      billingInterval: input.billingInterval,
      targetCapacity: input.capacity,
    },
    select: {
      id: true,
      version: true,
      checkoutAttemptId: true,
      items: { orderBy: [{ slotNumber: 'asc' }, { id: 'asc' }], select: { slotNumber: true, divisionIdSnapshot: true } },
    },
  });
  const existingAssignments = await tx.divisionCapacityAssignment.findMany({
    where: { billingPeriodId: input.billingPeriodId },
    select: { slotNumber: true, divisionIdSnapshot: true },
  });
  const usedSlots = new Set(existingAssignments.map(({ slotNumber }) => slotNumber));
  const usedDivisions = new Set(existingAssignments.map(({ divisionIdSnapshot }) => divisionIdSnapshot));
  let assignmentCount = 0;

  if (selection?.checkoutAttemptId) {
    for (const item of selection.items) {
      if (item.slotNumber > input.capacity || usedSlots.has(item.slotNumber)
        || usedDivisions.has(item.divisionIdSnapshot)) continue;
      if (await createInitialAssignment(tx, {
        billingPeriodId: input.billingPeriodId,
        billingAccountId: input.billingAccountId,
        ownerUserId: input.ownerUserId,
        divisionId: item.divisionIdSnapshot,
        slotNumber: item.slotNumber,
        assignedAt: input.assignedAt,
        assignmentSource: 'PURCHASE_SELECTION',
      })) {
        usedSlots.add(item.slotNumber);
        usedDivisions.add(item.divisionIdSnapshot);
        assignmentCount += 1;
      }
    }
    await finalizePurchaseSelection(tx, {
      selection: { id: selection.id, version: selection.version, checkoutAttemptId: selection.checkoutAttemptId },
      billingPeriodId: input.billingPeriodId, assignmentCount, capacity: input.capacity,
      providerSubscriptionChainId: input.providerSubscriptionChainId,
      providerTransactionId: input.providerTransactionId, completedAt: input.assignedAt,
    });
    return { assignmentCount, usedSelection: true };
  }

  const migration = await tx.billingMigrationAccess.findUnique({
    where: { billingAccountId: input.billingAccountId },
    select: {
      divisions: {
        where: { divisionId: { not: null } },
        orderBy: [{ divisionCreatedAtSnapshot: 'asc' }, { divisionIdSnapshot: 'asc' }],
        select: { divisionId: true },
      },
    },
  });
  const owned = await tx.division.findMany({
    where: { liga: { userId: input.ownerUserId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const candidates = [...(migration?.divisions.map(({ divisionId }) => divisionId).filter(Boolean) ?? []), ...owned.map(({ id }) => id)];
  for (const divisionId of new Set(candidates as string[])) {
    if (usedDivisions.has(divisionId)) continue;
    const slotNumber = Array.from({ length: input.capacity }, (_, index) => index + 1)
      .find((slot) => !usedSlots.has(slot));
    if (!slotNumber) break;
    if (await createInitialAssignment(tx, {
      billingPeriodId: input.billingPeriodId,
      billingAccountId: input.billingAccountId,
      ownerUserId: input.ownerUserId,
      divisionId,
      slotNumber,
      assignedAt: input.assignedAt,
      assignmentSource: 'PURCHASE_FALLBACK',
    })) {
      usedSlots.add(slotNumber);
      usedDivisions.add(divisionId);
      assignmentCount += 1;
    }
  }
  return { assignmentCount, usedSelection: false };
}

function isLegacyMaterializationAudit(metadata: Prisma.JsonValue): boolean {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    && metadata.usedPurchaseSelection === false;
}

async function recoverHistoricalPurchaseSelection(
  tx: Prisma.TransactionClient,
  input: {
    billingAccountId: string;
    ownerUserId: string;
    normalized: NormalizedGoogleCustomer;
    now: Date;
  },
): Promise<boolean> {
  const selection = await tx.billingPurchaseSelection.findFirst({
    where: {
      billingAccountId: input.billingAccountId,
      status: 'LOCKED',
      consumedByPeriodId: null,
      checkoutAttemptId: { not: null },
    },
    select: {
      id: true, version: true, lockedAt: true, checkoutAttemptId: true,
      logicalProductId: true, billingInterval: true, targetCapacity: true,
      items: {
        orderBy: [{ slotNumber: 'asc' }, { id: 'asc' }],
        select: { slotNumber: true, divisionIdSnapshot: true },
      },
      checkoutAttempt: {
        select: {
          id: true, billingAccountId: true, purchaseSelectionId: true, store: true, status: true,
          terminalAt: true, startedAt: true, logicalProductIdSnapshot: true,
          billingIntervalSnapshot: true, targetCapacitySnapshot: true,
          storeProductIdSnapshot: true, basePlanIdSnapshot: true,
          verification: { select: { status: true } },
        },
      },
    },
  });
  const attempt = selection?.checkoutAttempt;
  if (!selection?.checkoutAttemptId || !selection.lockedAt || !attempt
    || attempt.id !== selection.checkoutAttemptId
    || attempt.billingAccountId !== input.billingAccountId
    || attempt.purchaseSelectionId !== selection.id
    || attempt.store !== 'GOOGLE'
    || attempt.terminalAt !== null
    || ['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'].includes(attempt.status)
    || attempt.verification?.status !== 'PENDING'
    || selection.lockedAt.getTime() !== attempt.startedAt.getTime()
    || attempt.logicalProductIdSnapshot !== selection.logicalProductId
    || attempt.billingIntervalSnapshot !== selection.billingInterval
    || attempt.targetCapacitySnapshot !== selection.targetCapacity) return false;

  const periods = await tx.billingPeriod.findMany({
    where: {
      billingAccountId: input.billingAccountId,
      source: 'STORE',
      logicalProductIdSnapshot: selection.logicalProductId,
      billingIntervalAtStart: selection.billingInterval,
      capacityAtStart: selection.targetCapacity,
      effectiveStart: { gte: attempt.startedAt },
      createdAt: { gte: attempt.startedAt },
      OR: [
        { endedEarlyAt: { lte: input.now } },
        { endedEarlyAt: null, effectiveEnd: { lte: input.now } },
      ],
    },
    orderBy: [{ effectiveStart: 'asc' }, { id: 'asc' }],
    select: {
      id: true, effectiveStart: true, effectiveEnd: true, endedEarlyAt: true,
      providerStartedAt: true, createdAt: true,
      consumedPurchaseSelection: { select: { id: true } },
      assignments: {
        orderBy: [{ slotNumber: 'asc' }, { id: 'asc' }],
        select: { slotNumber: true, divisionIdSnapshot: true },
      },
      providerSources: { where: { isPrimary: true }, select: { billingProviderPeriodId: true } },
      primaryProviderPeriod: {
        select: {
          id: true, billingAccountId: true, providerSubscriptionId: true, providerPeriodKey: true,
          logicalProductId: true, storeProductId: true, basePlanId: true, capacity: true,
          billingInterval: true, providerPeriodStart: true, canonicalEvidenceReference: true,
          store: true, storeEnvironment: true,
          transaction: {
            select: {
              billingAccountId: true, providerSubscriptionId: true, providerTransactionId: true,
              logicalProductId: true, storeProductId: true, basePlanId: true, capacity: true,
              billingInterval: true, purchasedAt: true, store: true, storeEnvironment: true,
            },
          },
          subscription: {
            select: {
              providerSubscriptionKey: true, canonicalEvidenceReference: true,
              storeEnvironment: true, ownershipType: true, chain: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (periods.length === 0) return false;
  const audits = await tx.billingAuditLog.findMany({
    where: {
      action: 'BILLING_PERIOD_MATERIALIZED', targetType: 'BillingPeriod',
      targetId: { in: periods.map(({ id }) => id) }, createdAt: { gte: attempt.startedAt },
    },
    select: { targetId: true, metadataRedacted: true },
  });

  const matches = [];
  for (const period of periods) {
    const providerPeriod = period.primaryProviderPeriod;
    const transaction = providerPeriod.transaction;
    const subscription = providerPeriod.subscription;
    if (period.consumedPurchaseSelection
      || period.providerSources.length !== 1
      || period.providerSources[0].billingProviderPeriodId !== providerPeriod.id
      || period.providerStartedAt?.getTime() !== providerPeriod.providerPeriodStart.getTime()
      || !providerPeriod.canonicalEvidenceReference
      || !subscription.canonicalEvidenceReference
      || subscription.ownershipType !== 'PURCHASED'
      || !transaction
      || providerPeriod.billingAccountId !== input.billingAccountId
      || transaction.billingAccountId !== input.billingAccountId
      || transaction.providerSubscriptionId !== providerPeriod.providerSubscriptionId
      || providerPeriod.store !== 'GOOGLE'
      || transaction.store !== 'GOOGLE'
      || providerPeriod.storeEnvironment !== transaction.storeEnvironment
      || providerPeriod.storeEnvironment !== subscription.storeEnvironment
      || providerPeriod.logicalProductId !== selection.logicalProductId
      || transaction.logicalProductId !== selection.logicalProductId
      || providerPeriod.billingInterval !== selection.billingInterval
      || transaction.billingInterval !== selection.billingInterval
      || providerPeriod.capacity !== selection.targetCapacity
      || transaction.capacity !== selection.targetCapacity
      || providerPeriod.storeProductId !== attempt.storeProductIdSnapshot
      || transaction.storeProductId !== attempt.storeProductIdSnapshot
      || providerPeriod.basePlanId !== attempt.basePlanIdSnapshot
      || transaction.basePlanId !== attempt.basePlanIdSnapshot
      || transaction.purchasedAt.getTime() !== providerPeriod.providerPeriodStart.getTime()
      || transaction.purchasedAt < attempt.startedAt
      || period.effectiveStart < attempt.startedAt
      || period.createdAt < attempt.startedAt) continue;

    const periodAudits = audits.filter(({ targetId }) => targetId === period.id);
    if (periodAudits.length !== 1 || !isLegacyMaterializationAudit(periodAudits[0].metadataRedacted)) continue;
    const predecessor = await tx.billingPeriod.findFirst({
      where: {
        billingAccountId: input.billingAccountId, source: 'STORE',
        effectiveStart: { lt: period.effectiveStart },
      },
      orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
      select: { effectiveEnd: true, endedEarlyAt: true },
    });
    const predecessorEnd = predecessor?.endedEarlyAt ?? predecessor?.effectiveEnd;
    if (!predecessorEnd || providerPeriod.providerPeriodStart <= predecessorEnd) continue;

    const freshSubscription = input.normalized.subscriptions.find(({ providerSubscriptionKey }) =>
      providerSubscriptionKey === subscription.providerSubscriptionKey);
    const freshTransaction = freshSubscription?.transactions.find(({ providerTransactionId }) =>
      providerTransactionId === transaction.providerTransactionId);
    const freshPeriod = freshSubscription?.periods.find(({ providerTransactionId, providerPeriodKey }) =>
      providerTransactionId === transaction.providerTransactionId
      && providerPeriodKey === providerPeriod.providerPeriodKey);
    if (!freshSubscription?.canonicalEvidenceReference
      || freshSubscription.ownershipType !== 'PURCHASED'
      || !freshTransaction || !freshPeriod
      || !freshPeriod.canonicalEvidenceReference
      || freshTransaction.logicalProductId !== selection.logicalProductId
      || freshTransaction.billingInterval !== selection.billingInterval
      || freshTransaction.capacity !== selection.targetCapacity
      || freshTransaction.storeProductId !== attempt.storeProductIdSnapshot
      || freshTransaction.basePlanId !== attempt.basePlanIdSnapshot
      || freshTransaction.purchasedAt.getTime() !== transaction.purchasedAt.getTime()
      || freshPeriod.providerPeriodStart.getTime() !== providerPeriod.providerPeriodStart.getTime()) continue;
    matches.push(period);
  }
  if (matches.length !== 1) return false;

  const [period] = matches;
  const usedSlots = new Map(period.assignments.map((assignment) => [assignment.slotNumber, assignment.divisionIdSnapshot]));
  const usedDivisions = new Map(period.assignments.map((assignment) => [assignment.divisionIdSnapshot, assignment.slotNumber]));
  for (const item of selection.items) {
    const divisionAtSlot = usedSlots.get(item.slotNumber);
    const slotForDivision = usedDivisions.get(item.divisionIdSnapshot);
    if ((divisionAtSlot && divisionAtSlot !== item.divisionIdSnapshot)
      || (slotForDivision && slotForDivision !== item.slotNumber)) return false;
  }

  let assignmentCount = 0;
  for (const item of selection.items) {
    if (usedSlots.get(item.slotNumber) === item.divisionIdSnapshot) continue;
    if (await createInitialAssignment(tx, {
      billingPeriodId: period.id, billingAccountId: input.billingAccountId,
      ownerUserId: input.ownerUserId, divisionId: item.divisionIdSnapshot,
      slotNumber: item.slotNumber, assignedAt: period.effectiveStart,
      assignmentSource: 'PURCHASE_SELECTION',
    })) assignmentCount += 1;
  }
  await finalizePurchaseSelection(tx, {
    selection: { id: selection.id, version: selection.version, checkoutAttemptId: selection.checkoutAttemptId },
    billingPeriodId: period.id, assignmentCount, capacity: selection.targetCapacity,
    providerSubscriptionChainId: period.primaryProviderPeriod.subscription.chain.id,
    providerTransactionId: period.primaryProviderPeriod.transaction!.providerTransactionId,
    completedAt: input.now, historicalRecovery: true,
  });
  return true;
}

async function reconcileGoogleTwoStepChangeOperation(
  tx: Prisma.TransactionClient,
  billingAccountId: string,
  normalized: NormalizedGoogleCustomer,
  now: Date,
): Promise<void> {
  const operation = await tx.billingChangeOperation.findFirst({
    where: {
      billingAccountId, type: 'GOOGLE_TWO_STEP',
      status: { in: ['FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING', 'SECOND_STEP_PENDING', 'SCHEDULED'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, status: true, version: true, providerSubscriptionChainId: true, scheduledAt: true,
      intermediateVariant: true, targetVariant: true,
      providerSubscriptionChain: { select: { providerChainReference: true } },
      checkoutAttempts: {
        where: { purpose: { in: ['PRODUCT_CHANGE_FIRST_STEP', 'PRODUCT_CHANGE_FINAL_STEP'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, purpose: true, status: true, version: true, requestFingerprint: true,
          verification: { select: { id: true, status: true, attemptCount: true } },
        },
      },
    },
  });
  if (!operation) return;
  if (normalized.issues.some(({ severity }) => severity === 'BLOCKING')) return;
  const expectedEnvironment = env.APP_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX';
  const subscription = normalized.subscriptions.find((candidate) =>
    candidate.providerChainReference === operation.providerSubscriptionChain.providerChainReference);
  if (!subscription
    || subscription.storeEnvironment !== expectedEnvironment
    || subscription.ownershipType !== 'PURCHASED'
    || !subscription.entitlementActive
    || !subscription.eligibleForNewAccess
    || subscription.pendingPayment) return;
  const exact = (prefix: 'current' | 'pending', variant: typeof operation.targetVariant) => {
    const product = prefix === 'current' ? subscription.currentProduct : subscription.pendingProduct;
    if (!product) return false;
    return product.logicalProductId === variant.logicalProductId
      && product.storeProductId === variant.storeProductId
      && product.basePlanId === variant.basePlanId
      && product.capacity === variant.capacity
      && product.billingInterval === variant.billingInterval;
  };
  const verifyAttempt = async (
    purpose: 'PRODUCT_CHANGE_FIRST_STEP' | 'PRODUCT_CHANGE_FINAL_STEP',
  ) => {
    const attempt = operation.checkoutAttempts.find((candidate) => candidate.purpose === purpose);
    if (!attempt) return null;
    const verification = attempt.verification ?? await tx.billingVerification.create({
      data: {
        billingAccountId, checkoutAttemptId: attempt.id, store: 'GOOGLE',
        idempotencyKey: `canonical:${attempt.id}`.slice(0, 128),
        requestFingerprint: attempt.requestFingerprint, requestedAt: now,
      },
      select: { id: true, status: true, attemptCount: true },
    });
    if (verification.status === 'PENDING') {
      await tx.billingVerification.update({
        where: { id: verification.id },
        data: {
          status: 'VERIFIED', providerSubscriptionChainId: operation.providerSubscriptionChainId,
          lastAttemptAt: now, verifiedAt: now,
          attemptCount: Math.max(1, verification.attemptCount), lastErrorCode: null,
        },
      });
    }
    if (verification.status !== 'PENDING' && verification.status !== 'VERIFIED') return null;
    if (!['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'].includes(attempt.status)) {
      await tx.billingCheckoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'VERIFIED', terminalAt: now, nextVerificationAt: null,
          leaseUntil: null, lockedBy: null, lastVerificationAt: now,
          verificationAttempts: { increment: 1 }, lastErrorCode: null, version: { increment: 1 },
        },
      });
    }
    return verification.id;
  };

  if (operation.status === 'FIRST_PURCHASE_PENDING' && exact('current', operation.intermediateVariant)) {
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'FIRST_VERIFICATION_PENDING', version: { increment: 1 } },
    });
  }
  if ((operation.status === 'FIRST_PURCHASE_PENDING' || operation.status === 'FIRST_VERIFICATION_PENDING')
    && exact('current', operation.intermediateVariant)) {
    const verificationId = await verifyAttempt('PRODUCT_CHANGE_FIRST_STEP');
    if (!verificationId) return;
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'FIRST_VERIFIED', firstVerificationId: verificationId, version: { increment: 1 } },
    });
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'SECOND_STEP_PENDING', version: { increment: 1 } },
    });
    return;
  }
  if (operation.status === 'SECOND_STEP_PENDING' && exact('pending', operation.targetVariant)) {
    const verificationId = await verifyAttempt('PRODUCT_CHANGE_FINAL_STEP');
    if (!verificationId) return;
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: {
        status: 'SCHEDULED', secondVerificationId: verificationId,
        scheduledAt: subscription.pendingEffectiveAt ?? now, version: { increment: 1 },
      },
    });
    return;
  }
  if (operation.status === 'SECOND_STEP_PENDING' && exact('current', operation.targetVariant)) {
    const verificationId = await verifyAttempt('PRODUCT_CHANGE_FINAL_STEP');
    if (!verificationId) return;
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: {
        status: 'SCHEDULED', secondVerificationId: verificationId,
        scheduledAt: now, version: { increment: 1 },
      },
    });
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
    });
    return;
  }
  if (operation.status === 'SCHEDULED' && exact('current', operation.targetVariant)) {
    await tx.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
    });
  }
}

export async function materializeStoreEffectiveAccessInTransaction(
  billingAccountId: string,
  normalized: NormalizedGoogleCustomer,
  tx: Prisma.TransactionClient,
): Promise<'NONE' | 'BLOCKED' | 'UNCHANGED' | 'PERIOD_CREATED' | 'CAPACITY_GRANTED'> {
  const account = await tx.billingAccount.findUnique({
    where: { id: billingAccountId },
    select: { userId: true },
  });
  if (!account?.userId) {
    await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
      reason: 'detached_account',
    });
    return 'BLOCKED';
  }

  const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  await reconcileGoogleTwoStepChangeOperation(tx, billingAccountId, normalized, now);
  await recoverHistoricalPurchaseSelection(tx, {
    billingAccountId, ownerUserId: account.userId, normalized, now,
  });
  const subscriptionKeys = normalized.subscriptions.map(({ providerSubscriptionKey }) => providerSubscriptionKey);
  const newAccessSubscriptionKeys = new Set(normalized.subscriptions
    .filter(({ eligibleForNewAccess }) => eligibleForNewAccess)
    .map(({ providerSubscriptionKey }) => providerSubscriptionKey));
  const continuedAccessSubscriptionKeys = new Set(normalized.subscriptions
    .filter(({ eligibleForContinuedAccess }) => eligibleForContinuedAccess)
    .map(({ providerSubscriptionKey }) => providerSubscriptionKey));
  const localGraceSubscriptionKeys = new Set(normalized.subscriptions
    .filter(({ eligibleForLocalGrace }) => eligibleForLocalGrace)
    .map(({ providerSubscriptionKey }) => providerSubscriptionKey));
  const subscriptions = await tx.billingProviderSubscription.findMany({
    where: { store: 'GOOGLE', providerSubscriptionKey: { in: subscriptionKeys } },
    select: {
      id: true,
      providerSubscriptionKey: true,
      providerStatus: true,
      entitlementActive: true,
      providerEndReason: true,
      ownershipType: true,
      canonicalEvidenceReference: true,
      currentCapacity: true,
      willRenew: true,
      providerAccessEndsAt: true,
      chain: { select: { id: true } },
      providerPeriods: {
        orderBy: [{ providerPeriodStart: 'desc' }, { revision: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          billingTransactionId: true,
          transaction: { select: { providerTransactionId: true } },
          providerPeriodKey: true,
          revision: true,
          logicalProductId: true,
          capacity: true,
          billingInterval: true,
          providerPeriodStart: true,
          providerPeriodEnd: true,
        },
      },
    },
  });
  const periodSelect = {
    id: true,
    effectiveStart: true,
    effectiveEnd: true,
    endedEarlyAt: true,
    capacityAtStart: true,
    logicalProductIdSnapshot: true,
    billingIntervalAtStart: true,
    materializationKey: true,
    primaryProviderPeriod: {
      select: {
        subscription: { select: { providerSubscriptionKey: true, chain: { select: { id: true } } } },
      },
    },
    capacityGrants: {
      orderBy: [{ effectiveAt: 'desc' as const }, { sequence: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
      select: { newCapacity: true, sequence: true, logicalProductIdSnapshot: true },
    },
    assignments: {
      orderBy: [{ slotNumber: 'asc' as const }, { id: 'asc' as const }],
      select: {
        id: true, assignedAt: true, divisionId: true, divisionIdSnapshot: true, divisionNameSnapshot: true,
        leagueIdSnapshot: true, leagueNameSnapshot: true, ownerUserIdSnapshot: true, slotNumber: true,
      },
    },
  } satisfies Prisma.BillingPeriodSelect;
  const currentPeriod = await tx.billingPeriod.findFirst({
    where: {
      billingAccountId,
      source: 'STORE',
      effectiveStart: { lte: now },
      effectiveEnd: { gt: now },
      OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: now } }],
    },
    orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
    select: periodSelect,
  });
  const latestPeriod = await tx.billingPeriod.findFirst({
    where: { billingAccountId, source: 'STORE' },
    orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
    select: periodSelect,
  });
  const predecessorPeriod = currentPeriod ?? latestPeriod;
  let activeGrace = await tx.billingLocalGrace.findFirst({
    where: { billingAccountId, status: 'ACTIVE' },
    select: {
      id: true,
      startedAt: true,
      endsAt: true,
      sourceBillingPeriodId: true,
      sourceBillingPeriod: { select: periodSelect },
    },
  });
  const proposal = evaluateStoreEffectiveAccess({
    candidates: subscriptions.map((subscription) => ({
      id: subscription.id,
      chainId: subscription.chain.id,
      providerStatus: subscription.providerStatus,
      entitlementActive: subscription.entitlementActive,
      ownershipType: subscription.ownershipType,
      canonicalEvidenceReference: (continuedAccessSubscriptionKeys.has(subscription.providerSubscriptionKey)
        || localGraceSubscriptionKeys.has(subscription.providerSubscriptionKey))
        ? subscription.canonicalEvidenceReference
        : null,
      currentCapacity: subscription.currentCapacity,
      willRenew: subscription.willRenew,
      providerAccessEndsAt: subscription.providerAccessEndsAt,
      providerEndReason: subscription.providerEndReason,
      eligibleForContinuedAccess: continuedAccessSubscriptionKeys.has(subscription.providerSubscriptionKey),
      eligibleForNewAccess: newAccessSubscriptionKeys.has(subscription.providerSubscriptionKey),
      eligibleForLocalGrace: localGraceSubscriptionKeys.has(subscription.providerSubscriptionKey),
    })),
    previousPrimaryChainId: predecessorPeriod?.primaryProviderPeriod.subscription.chain.id ?? null,
    now,
  });
  const sourceById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  if (proposal.state === 'LOCAL_GRACE_CANDIDATE') {
    const candidate = sourceById.get(proposal.primarySourceId);
    const sourcePeriod = currentPeriod ?? latestPeriod;
    const sourceChainId = sourcePeriod?.primaryProviderPeriod.subscription.chain.id;
    if (!candidate || !sourcePeriod || sourceChainId !== proposal.primaryChainId) {
      await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
        reason: 'local_grace_source_mismatch',
      });
      return 'BLOCKED';
    }
    if (currentPeriod) {
      await tx.billingPeriod.update({
        where: { id: currentPeriod.id },
        data: {
          endedEarlyAt: now,
          endReason: 'PROVIDER_CORRECTION',
          providerEndedAt: proposal.graceStartedAt,
        },
      });
      await audit(tx, 'BILLING_PERIOD_ENDED', 'BillingPeriod', currentPeriod.id, {
        reason: 'PROVIDER_CORRECTION',
      });
    }
    const started = await startLocalGraceInTransaction(tx, {
      billingAccountId,
      sourceBillingPeriodId: sourcePeriod.id,
      providerSubscriptionId: candidate.id,
      graceStartedAt: proposal.graceStartedAt,
      now,
    });
    if (started.grace.endsAt <= now) {
      await expireLocalGraceInTransaction(tx, { graceId: started.grace.id, now, createFreeGrant: true });
    }
    return 'NONE';
  }
  if (proposal.state !== 'ACTIVE') {
    const currentSource = normalized.subscriptions.find(({ providerSubscriptionKey }) =>
      providerSubscriptionKey === currentPeriod?.primaryProviderPeriod.subscription.providerSubscriptionKey);
    const terminalReason = terminalPeriodReason(currentSource?.providerEndReason);
    const correctedEndElapsed = currentSource?.providerAccessEndsAt
      && currentSource.providerAccessEndsAt <= now
      && currentSource.providerAccessEndsAt < (currentPeriod?.effectiveEnd ?? currentSource.providerAccessEndsAt);
    const endReason = terminalReason ?? (correctedEndElapsed ? 'PROVIDER_CORRECTION' : null);
    if (activeGrace?.endsAt && activeGrace.endsAt <= now) {
      await expireLocalGraceInTransaction(tx, { graceId: activeGrace.id, now, createFreeGrant: true });
      return 'NONE';
    }
    if (activeGrace && terminalReason) {
      await terminateLocalGraceInTransaction(tx, {
        graceId: activeGrace.id,
        now,
        reason: terminalReason,
      });
      return 'NONE';
    }
    if (currentPeriod && endReason) {
      await tx.billingPeriod.update({
        where: { id: currentPeriod.id },
        data: {
          endedEarlyAt: now,
          endReason,
          providerEndedAt: currentSource?.providerAccessEndsAt,
        },
      });
      const freeGrantCreated = await createPaidExpirationFreeGrantInTransaction(tx, {
        billingAccountId,
        sourceBillingPeriodId: currentPeriod.id,
        eligibleAt: now,
        grantedAt: now,
      });
      await audit(tx, 'BILLING_PERIOD_ENDED', 'BillingPeriod', currentPeriod.id, {
        reason: endReason,
        freeGrantCreated,
      });
      return 'NONE';
    }
    if (!activeGrace && latestPeriod && (latestPeriod.endedEarlyAt ?? latestPeriod.effectiveEnd) <= now) {
      const freeGrantCreated = await createPaidExpirationFreeGrantInTransaction(tx, {
        billingAccountId,
        sourceBillingPeriodId: latestPeriod.id,
        eligibleAt: latestPeriod.endedEarlyAt ?? latestPeriod.effectiveEnd,
        grantedAt: now,
      });
      if (freeGrantCreated) {
        await audit(tx, 'BILLING_PERIOD_ENDED', 'BillingPeriod', latestPeriod.id, {
          reason: 'NATURAL_EXPIRATION',
          freeGrantCreated: true,
        });
      }
    }
    if (proposal.state === 'BLOCKED') {
      await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
        reason: 'ineligible_active_source',
      });
    }
    return proposal.state;
  }

  const primarySubscription = sourceById.get(proposal.primarySourceId);
  const primaryProviderPeriod = primarySubscription?.providerPeriods[0];
  if (!primarySubscription || !primaryProviderPeriod) {
    await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
      reason: 'missing_primary_provider_period',
    });
    return 'BLOCKED';
  }
  if (!currentPeriod && !activeGrace
    && !newAccessSubscriptionKeys.has(primarySubscription.providerSubscriptionKey)) {
    await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
      reason: 'pending_source_cannot_create_access',
    });
    return 'BLOCKED';
  }
  let expiredGraceBeforeActive = false;
  if (activeGrace?.endsAt && activeGrace.endsAt <= now) {
    await expireLocalGraceInTransaction(tx, { graceId: activeGrace.id, now, createFreeGrant: false });
    activeGrace = null;
    expiredGraceBeforeActive = true;
  }
  const eligibleProviderPeriods = proposal.eligibleSourceIds
    .map((id) => sourceById.get(id)?.providerPeriods[0])
    .filter((period): period is NonNullable<typeof period> => period !== undefined);
  if (eligibleProviderPeriods.length !== proposal.eligibleSourceIds.length) return 'BLOCKED';

  if (primaryProviderPeriod.providerPeriodEnd <= now) return 'NONE';
  const evidenceMaterializationKey = billingEvidenceHash('effective-billing-period', {
    billingAccountId,
    primaryChainId: primarySubscription.chain.id,
    providerPeriodKey: primaryProviderPeriod.providerPeriodKey,
    revision: primaryProviderPeriod.revision,
    product: primaryProviderPeriod.logicalProductId,
    capacity: primaryProviderPeriod.capacity,
    interval: primaryProviderPeriod.billingInterval,
    start: primaryProviderPeriod.providerPeriodStart.toISOString(),
    end: primaryProviderPeriod.providerPeriodEnd.toISOString(),
  });
  const materializationKey = activeGrace
    ? `store-grace-recovery:v1:${activeGrace.id}:${evidenceMaterializationKey}`
    : `store:v1:${evidenceMaterializationKey}`;
  const currentCapacity = currentPeriod?.capacityGrants[0]?.newCapacity ?? currentPeriod?.capacityAtStart;
  const currentLogicalProduct = currentPeriod?.capacityGrants[0]?.logicalProductIdSnapshot
    ?? currentPeriod?.logicalProductIdSnapshot;
  const activeFreeGrant = await tx.freeManagementGrant.findFirst({
    where: { billingAccountId, userId: account.userId, endedAt: null },
    select: {
      id: true, divisionId: true, divisionIdSnapshot: true, divisionNameSnapshot: true,
      leagueIdSnapshot: true, leagueNameSnapshot: true,
    },
  });
  if (activeFreeGrant && !activeFreeGrant.divisionId) {
    throw new AppError(409, 'El grant gratuito activo no conserva una division vigente', 'BILLING_FREE_GRANT_INVALID');
  }
  const purchaseTransition = activeGrace ? false : expiredGraceBeforeActive ? true : isPurchaseTransition({
    hasCurrentPeriod: currentPeriod !== null,
    predecessorAccessEnd: predecessorPeriod?.endedEarlyAt ?? predecessorPeriod?.effectiveEnd ?? null,
    providerPeriodStart: primaryProviderPeriod.providerPeriodStart,
    hasActiveFreeGrant: activeFreeGrant !== null,
  });
  const samePrimaryChain = currentPeriod?.primaryProviderPeriod.subscription.chain.id === primarySubscription.chain.id;
  const sameCycleEnd = currentPeriod?.effectiveEnd.getTime() === primaryProviderPeriod.providerPeriodEnd.getTime();
  const sameCommercialState = currentPeriod && samePrimaryChain && sameCycleEnd
    && currentCapacity === primaryProviderPeriod.capacity
    && currentLogicalProduct === primaryProviderPeriod.logicalProductId
    && currentPeriod.billingIntervalAtStart === primaryProviderPeriod.billingInterval;
  if (!activeGrace && !newAccessSubscriptionKeys.has(primarySubscription.providerSubscriptionKey)
    && !sameCommercialState) {
    await audit(tx, 'BILLING_MATERIALIZATION_BLOCKED', 'BillingAccount', billingAccountId, {
      reason: 'pending_source_cannot_change_access',
    });
    return 'BLOCKED';
  }
  await markMigrationPurchasedInTransaction(tx, billingAccountId);
  if (currentPeriod && activeFreeGrant?.divisionId) {
    if (currentPeriod.assignments.some(({ slotNumber }) => slotNumber === 1)) {
      throw new AppError(
        409,
        'El grant gratuito no puede convertirse porque el slot 1 ya está reservado',
        'BILLING_FREE_GRANT_CONFLICT',
      );
    }
    const assignment = await tx.divisionCapacityAssignment.create({
      data: {
        billingPeriodId: currentPeriod.id,
        slotNumber: 1,
        divisionId: activeFreeGrant.divisionId,
        divisionIdSnapshot: activeFreeGrant.divisionIdSnapshot,
        divisionNameSnapshot: activeFreeGrant.divisionNameSnapshot,
        leagueIdSnapshot: activeFreeGrant.leagueIdSnapshot,
        leagueNameSnapshot: activeFreeGrant.leagueNameSnapshot,
        ownerUserIdSnapshot: account.userId,
        assignedAt: now,
        assignmentSource: 'FREE_CONVERSION',
      },
      select: { id: true },
    });
    const conversion = await tx.freeManagementGrant.updateMany({
      where: { id: activeFreeGrant.id, billingAccountId, endedAt: null },
      data: {
        endedAt: now,
        endReason: 'PAID_CONVERSION',
        convertedToBillingPeriodId: currentPeriod.id,
        convertedToAssignmentId: assignment.id,
      },
    });
    if (conversion.count !== 1) {
      throw new AppError(409, 'El grant gratuito cambio durante la conversion', 'BILLING_FREE_GRANT_CONFLICT');
    }
    await audit(tx, 'BILLING_DIVISION_ASSIGNED', 'DivisionCapacityAssignment', assignment.id, {
      slotNumber: 1,
      assignmentSource: 'FREE_CONVERSION',
      freeManagementGrantId: activeFreeGrant.id,
      repairedExistingPeriod: true,
    });
  }
  if (sameCommercialState || currentPeriod?.materializationKey === materializationKey
    || await tx.billingPeriod.findUnique({
      where: { billingAccountId_materializationKey: { billingAccountId, materializationKey } }, select: { id: true },
    })) return 'UNCHANGED';

  if (currentPeriod && samePrimaryChain && sameCycleEnd && currentCapacity !== undefined
    && currentPeriod.billingIntervalAtStart === primaryProviderPeriod.billingInterval
    && primaryProviderPeriod.capacity > currentCapacity && primaryProviderPeriod.billingTransactionId) {
    const grant = await tx.billingCapacityGrant.create({
      data: {
        billingPeriodId: currentPeriod.id,
        billingTransactionId: primaryProviderPeriod.billingTransactionId,
        previousCapacity: currentCapacity,
        newCapacity: primaryProviderPeriod.capacity,
        logicalProductIdSnapshot: primaryProviderPeriod.logicalProductId,
        effectiveAt: now,
        sequence: (currentPeriod.capacityGrants[0]?.sequence ?? 0) + 1,
      },
      select: { id: true },
    });
    await audit(tx, 'BILLING_CAPACITY_GRANTED', 'BillingCapacityGrant', grant.id, {
      previousCapacity: currentCapacity,
      newCapacity: primaryProviderPeriod.capacity,
    });
    return 'CAPACITY_GRANTED';
  }

  if (primaryProviderPeriod.providerPeriodStart > now) return 'NONE';
  const effectiveStart = now;
  if (effectiveStart >= primaryProviderPeriod.providerPeriodEnd) return 'NONE';
  const periodId = `billing_period_${randomUUID()}`;
  if (currentPeriod) {
    await tx.billingPeriod.update({
      where: { id: currentPeriod.id },
      data: {
        endedEarlyAt: now,
        endReason: 'SUPERSEDED',
        replacedByPeriodId: periodId,
        providerEndedAt: currentPeriod.effectiveEnd,
      },
    });
  }
  await tx.billingPeriod.create({
    data: {
      id: periodId,
      billingAccountId,
      materializationKey,
      logicalProductIdSnapshot: primaryProviderPeriod.logicalProductId,
      capacityAtStart: primaryProviderPeriod.capacity,
      billingIntervalAtStart: primaryProviderPeriod.billingInterval,
      effectiveStart,
      effectiveEnd: primaryProviderPeriod.providerPeriodEnd,
      providerStartedAt: primaryProviderPeriod.providerPeriodStart,
      primaryProviderPeriodId: primaryProviderPeriod.id,
      renewalOfPeriodId: !purchaseTransition && predecessorPeriod
        && predecessorPeriod.primaryProviderPeriod.subscription.chain.id === primarySubscription.chain.id
        ? predecessorPeriod.id
        : null,
      enforcedAt: now,
      providerSources: {
        create: eligibleProviderPeriods.map((period) => ({
          billingProviderPeriodId: period.id,
          isPrimary: period.id === primaryProviderPeriod.id,
        })),
      },
    },
  });
  let convertedFreeGrant = false;
  if (!currentPeriod && activeFreeGrant?.divisionId) {
    const assignment = await tx.divisionCapacityAssignment.create({
      data: {
        billingPeriodId: periodId,
        slotNumber: 1,
        divisionId: activeFreeGrant.divisionId,
        divisionIdSnapshot: activeFreeGrant.divisionIdSnapshot,
        divisionNameSnapshot: activeFreeGrant.divisionNameSnapshot,
        leagueIdSnapshot: activeFreeGrant.leagueIdSnapshot,
        leagueNameSnapshot: activeFreeGrant.leagueNameSnapshot,
        ownerUserIdSnapshot: account.userId,
        assignedAt: effectiveStart,
        assignmentSource: 'FREE_CONVERSION',
      },
      select: { id: true },
    });
    const conversion = await tx.freeManagementGrant.updateMany({
      where: { id: activeFreeGrant.id, billingAccountId, endedAt: null },
      data: {
        endedAt: now,
        endReason: 'PAID_CONVERSION',
        convertedToBillingPeriodId: periodId,
        convertedToAssignmentId: assignment.id,
      },
    });
    if (conversion.count !== 1) {
      throw new AppError(409, 'El grant gratuito cambio durante la conversion', 'BILLING_FREE_GRANT_CONFLICT');
    }
    await audit(tx, 'BILLING_DIVISION_ASSIGNED', 'DivisionCapacityAssignment', assignment.id, {
      slotNumber: 1,
      assignmentSource: 'FREE_CONVERSION',
      freeManagementGrantId: activeFreeGrant.id,
    });
    convertedFreeGrant = true;
  }
  const assignmentPredecessor = activeGrace?.sourceBillingPeriod ?? predecessorPeriod;
  const predecessorCapacity = assignmentPredecessor
    ? assignmentPredecessor.capacityGrants[0]?.newCapacity ?? assignmentPredecessor.capacityAtStart
    : primaryProviderPeriod.capacity;
  const initialSelection = purchaseTransition
    ? await applyInitialPurchaseSelection(tx, {
      billingAccountId,
      ownerUserId: account.userId,
      billingPeriodId: periodId,
      logicalProductId: primaryProviderPeriod.logicalProductId,
      billingInterval: primaryProviderPeriod.billingInterval,
      capacity: primaryProviderPeriod.capacity,
      assignedAt: effectiveStart,
      providerSubscriptionChainId: primarySubscription.chain.id,
      providerTransactionId: primaryProviderPeriod.transaction?.providerTransactionId ?? null,
    })
    : { assignmentCount: 0, usedSelection: false };
  const rolloverAssignments = !purchaseTransition && assignmentPredecessor ? planRolloverAssignments(
    activeGrace
      ? assignmentPredecessor.assignments.filter(({ assignedAt }) => assignedAt <= activeGrace.startedAt)
      : assignmentPredecessor.assignments,
    predecessorCapacity,
    primaryProviderPeriod.capacity,
  ).map((assignment) => activeGrace && primaryProviderPeriod.capacity >= predecessorCapacity
    ? { ...assignment, assignmentSource: 'GRACE_RECOVERY' as const }
    : assignment) : [];
  for (const assignment of rolloverAssignments) {
    const created = await tx.divisionCapacityAssignment.create({
      data: {
        billingPeriodId: periodId,
        slotNumber: assignment.slotNumber,
        divisionId: assignment.divisionId,
        divisionIdSnapshot: assignment.divisionIdSnapshot,
        divisionNameSnapshot: assignment.divisionNameSnapshot,
        leagueIdSnapshot: assignment.leagueIdSnapshot,
        leagueNameSnapshot: assignment.leagueNameSnapshot,
        ownerUserIdSnapshot: assignment.ownerUserIdSnapshot,
        assignedAt: effectiveStart,
        assignmentSource: assignment.assignmentSource,
      },
      select: { id: true, slotNumber: true },
    });
    await audit(tx, 'BILLING_DIVISION_ASSIGNED', 'DivisionCapacityAssignment', created.id, {
      slotNumber: created.slotNumber,
      assignmentSource: assignment.assignmentSource,
    });
  }
  if (currentPeriod) {
    await audit(tx, 'BILLING_PERIOD_SUPERSEDED', 'BillingPeriod', currentPeriod.id, {
      replacementPeriodId: periodId,
    });
  }
  if (activeGrace) {
    await recoverLocalGraceInTransaction(tx, {
      graceId: activeGrace.id,
      recoveryBillingPeriodId: periodId,
      recoveredAt: now,
    });
  }
  await audit(tx, 'BILLING_PERIOD_MATERIALIZED', 'BillingPeriod', periodId, {
    capacity: primaryProviderPeriod.capacity,
    sourceCount: eligibleProviderPeriods.length,
    rolloverAssignmentCount: rolloverAssignments.length,
    initialAssignmentCount: initialSelection.assignmentCount,
    usedPurchaseSelection: initialSelection.usedSelection,
    convertedFreeGrant,
  });
  return 'PERIOD_CREATED';
}

export const effectiveAccessMaterializerInternals = {
  isPurchaseTransition,
  planRolloverAssignments,
  reconcileGoogleTwoStepChangeOperation,
};

export async function persistLedgerAndMaterializeStoreAccess(
  billingAccountId: string,
  normalized: NormalizedGoogleCustomer,
  client: PrismaClient = prisma,
): Promise<LedgerCounts> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await client.$transaction(async (tx) => {
        await acquireBillingAccountLock(tx, billingAccountId);
        const result = await persistNormalizedGoogleLedgerInTransaction(billingAccountId, normalized, tx);
        await materializeStoreEffectiveAccessInTransaction(billingAccountId, normalized, tx);
        return result;
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
      signalBackgroundJob('billing-grace-expiry');
      return result;
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') {
        throw new AppError(409, 'La materializacion de billing cambio durante la reconciliacion', 'BILLING_MATERIALIZATION_CONFLICT');
      }
      if ((error as { code?: unknown })?.code === 'P2002') throw ownershipConflict();
      throw error;
    }
  }
  throw new AppError(409, 'La materializacion de billing no pudo completarse', 'BILLING_MATERIALIZATION_CONFLICT');
}

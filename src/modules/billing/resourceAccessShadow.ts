import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { wouldAllowManagementCapability, type ManagementCapability } from './resourceAccessPolicy';
import {
  resolveDivisionAccessShadowInTransaction,
  resolveLeagueAccessShadowInTransaction,
  type ResourceActor,
} from './resourceAccessResolver';

export {
  resolveDivisionAccessShadowInTransaction,
  resolveLeagueAccessShadowInTransaction,
} from './resourceAccessResolver';
export type { ManagementCapability } from './resourceAccessPolicy';
export type {
  ManagementAccess,
  ManagementReason,
  ResourceAccessDecision,
} from './resourceAccessResolver';

type ResourceAccessInput = {
  operation: string;
  capability: ManagementCapability;
  actor?: ResourceActor;
  divisionId?: string;
  leagueId?: string;
  resourceType?: 'DIVISION' | 'LEAGUE' | 'SHARED_RESOURCE';
  affectedDivisionIds?: string[];
};

async function resolveDecision(tx: Prisma.TransactionClient, input: ResourceAccessInput) {
  return input.divisionId
    ? resolveDivisionAccessShadowInTransaction(tx, { divisionId: input.divisionId, actor: input.actor })
    : resolveLeagueAccessShadowInTransaction(tx, {
      leagueId: input.leagueId!,
      actor: input.actor,
      resourceType: input.resourceType === 'SHARED_RESOURCE' ? 'SHARED_RESOURCE' : 'LEAGUE',
      affectedDivisionIds: input.affectedDivisionIds,
    });
}

function deniedAccessError(decision: Awaited<ReturnType<typeof resolveDecision>>) {
  if (decision.reason === 'SHARED_RESOURCE_LOCKED') {
    return new AppError(403, 'El recurso compartido afecta una división de solo lectura', 'BILLING_SHARED_RESOURCE_LOCKED');
  }
  if (decision.reason === 'CAPACITY_REQUIRED') {
    return new AppError(422, 'Se requiere capacidad disponible para esta operación', 'BILLING_CAPACITY_REQUIRED');
  }
  if (decision.reason === 'UNASSIGNED' || decision.reason === 'EXPIRED') {
    return new AppError(403, 'El recurso está disponible en modo lectura', 'BILLING_RESOURCE_READ_ONLY');
  }
  if (decision.reason === 'ROLE_REQUIRED') {
    return new AppError(403, 'No autorizado', 'BILLING_ROLE_REQUIRED');
  }
  return new AppError(409, 'La evidencia de billing no permite autorizar la operación', 'BILLING_EVIDENCE_INVALID');
}

export async function assertResourceAccessInTransaction(
  tx: Prisma.TransactionClient,
  input: ResourceAccessInput,
): Promise<void> {
  if (!env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED) return;
  const decision = await resolveDecision(tx, input);
  if (!wouldAllowManagementCapability(decision, input.capability)) throw deniedAccessError(decision);
}

export async function observeResourceAccessShadowInTransaction(
  tx: Prisma.TransactionClient,
  input: ResourceAccessInput,
): Promise<void> {
  if (env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED) {
    await assertResourceAccessInTransaction(tx, input);
  }
  if (!env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED) return;
  const savepointClient = tx as Prisma.TransactionClient & {
    $executeRawUnsafe?: (query: string) => Promise<unknown>;
  };
  let savepointCreated = false;
  try {
    if (savepointClient.$executeRawUnsafe) {
      await savepointClient.$executeRawUnsafe('SAVEPOINT billing_resource_access_shadow');
      savepointCreated = true;
    }
    const decision = await resolveDecision(tx, input);
    const fields = {
      event: 'billing.resource_access_shadow_decision',
      operation: input.operation,
      capability: input.capability,
      resourceType: decision.resourceType,
      access: decision.access,
      reason: decision.reason,
      basis: decision.basis,
      paidCapacity: decision.paidCapacity,
      assignedCount: decision.assignedCount,
      wouldAllow: wouldAllowManagementCapability(decision, input.capability),
      migrationPrepared: decision.migrationPrepared,
      migrationResourceCaptured: decision.migrationResourceCaptured,
      migrationCapturedCount: decision.migrationCapturedCount,
    };
    if (decision.access === 'BLOCKED') logger.warn(fields, 'Resource access shadow blocked');
    else logger.info(fields, 'Resource access shadow evaluated');
    if (savepointCreated) {
      await savepointClient.$executeRawUnsafe!('RELEASE SAVEPOINT billing_resource_access_shadow');
    }
  } catch (cause) {
    if (savepointCreated) {
      try {
        await savepointClient.$executeRawUnsafe!('ROLLBACK TO SAVEPOINT billing_resource_access_shadow');
        await savepointClient.$executeRawUnsafe!('RELEASE SAVEPOINT billing_resource_access_shadow');
      } catch {
        // The functional transaction will surface an unusable connection on its next statement.
      }
    }
    logger.warn({
      event: 'billing.resource_access_shadow_decision',
      operation: input.operation,
      capability: input.capability,
      resourceType: input.resourceType ?? (input.divisionId ? 'DIVISION' : 'LEAGUE'),
      access: 'BLOCKED',
      reason: 'INVALID_BILLING_EVIDENCE',
      wouldAllow: false,
      causeType: cause instanceof Error ? cause.name : typeof cause,
      causeCode: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined,
    }, 'Resource access shadow query failed');
  }
}

export async function observeResourceAccessShadow(
  input: Parameters<typeof observeResourceAccessShadowInTransaction>[1],
  client: PrismaClient = prisma,
): Promise<void> {
  if (env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED) {
    throw new AppError(
      503,
      'La operación todavía no está preparada para enforcement transaccional',
      'BILLING_ENFORCEMENT_TRANSACTION_REQUIRED',
    );
  }
  if (!env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED) return;
  try {
    await client.$transaction(
      (tx) => observeResourceAccessShadowInTransaction(tx, input),
      { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 15_000 },
    );
  } catch (cause) {
    logger.warn({
      event: 'billing.resource_access_shadow_decision',
      operation: input.operation,
      capability: input.capability,
      resourceType: input.resourceType ?? (input.divisionId ? 'DIVISION' : 'LEAGUE'),
      access: 'BLOCKED',
      reason: 'INVALID_BILLING_EVIDENCE',
      wouldAllow: false,
      causeType: cause instanceof Error ? cause.name : typeof cause,
      causeCode: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined,
    }, 'Resource access shadow transaction failed');
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Prisma, type BillingEnvironment, type BillingOperationalMode, type PrismaClient } from '../../generated/prisma/client';
import { AppError, ConflictError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import type { BillingOperationalControlInput } from './operationalControlValidator';
import { signalBackgroundJob } from '../../workers/jobSignals';

function currentBillingEnvironment(): BillingEnvironment {
  return env.APP_ENV === 'production' ? 'PRODUCTION' : 'PREVIEW';
}

interface AdminActor {
  userId: string;
  requestId: string;
}

interface ControlMetadata {
  environment: BillingEnvironment;
  previousMode: BillingOperationalMode;
  resultingMode: BillingOperationalMode;
  previousVersion: number;
  resultingVersion: number;
  resultingReason: string;
  changedAt: string;
}

export interface BillingOperationalControlDto {
  environment: BillingEnvironment;
  mode: BillingOperationalMode;
  reason: string;
  changedAt: Date;
  version: number;
}

export async function auditDevelopmentBillingOperationalControls(
  client: PrismaClient,
): Promise<BillingOperationalControlDto[]> {
  assertDevelopmentScriptContext();
  const controls = await client.billingOperationalControl.findMany({
    orderBy: { environment: 'asc' },
    select: { environment: true, mode: true, reason: true, changedAt: true, version: true },
  });
  return controls.map(dto);
}

export function formatDevelopmentBillingOperationalControls(
  controls: BillingOperationalControlDto[],
): string {
  const values = controls.map(({ environment, mode, version }) => `${environment}=${mode}@${version}`).join(' ');
  return `Billing operational controls: count=${controls.length}${values ? ` ${values}` : ''}.`;
}

function fingerprint(
  environment: BillingEnvironment,
  input: BillingOperationalControlInput,
): string {
  return createHash('sha256').update(JSON.stringify({ environment, ...input })).digest('hex');
}

function metadata(value: Prisma.JsonValue): ControlMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_operational_control_audit_metadata');
  }
  const candidate = value as Record<string, unknown>;
  if (!['PREVIEW', 'PRODUCTION'].includes(String(candidate.environment))
    || !['ENABLED', 'PURCHASES_PAUSED'].includes(String(candidate.resultingMode))
    || typeof candidate.resultingVersion !== 'number'
    || typeof candidate.resultingReason !== 'string'
    || typeof candidate.changedAt !== 'string') {
    throw new Error('invalid_operational_control_audit_metadata');
  }
  return candidate as unknown as ControlMetadata;
}

function dto(control: {
  environment: BillingEnvironment;
  mode: BillingOperationalMode;
  reason: string;
  changedAt: Date;
  version: number;
}): BillingOperationalControlDto {
  return { ...control };
}

export async function getAdminBillingOperationalControl(
  actor: AdminActor,
  client: PrismaClient = prisma,
): Promise<BillingOperationalControlDto> {
  const environment = currentBillingEnvironment();
  return client.$transaction(async (tx) => {
    const control = await tx.billingOperationalControl.findUnique({
      where: { environment },
      select: { environment: true, mode: true, reason: true, changedAt: true, version: true },
    });
    if (!control) {
      throw new AppError(503, 'El control operacional de billing no está disponible', 'BILLING_OPERATIONAL_CONTROL_MISSING');
    }
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_OPERATIONAL_CONTROL_VIEWED',
        actorType: 'USER',
        actorUserId: actor.userId,
        actorUserIdSnapshot: actor.userId,
        targetType: 'BILLING_OPERATIONAL_CONTROL',
        targetId: environment,
        requestId: actor.requestId,
        metadataRedacted: { environment, mode: control.mode, version: control.version },
      },
    });
    return dto(control);
  });
}

export async function setAdminBillingOperationalControl(input: {
  control: BillingOperationalControlInput;
  idempotencyKey: string;
  actor: AdminActor;
}, client: PrismaClient = prisma): Promise<BillingOperationalControlDto> {
  const environment = currentBillingEnvironment();
  const requestFingerprint = fingerprint(environment, input.control);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `billing-operational-control:${environment}`,
    );
    const control = await tx.billingOperationalControl.findUnique({
      where: { environment },
      select: { environment: true, mode: true, reason: true, changedAt: true, version: true },
    });
    if (!control) {
      throw new AppError(503, 'El control operacional de billing no está disponible', 'BILLING_OPERATIONAL_CONTROL_MISSING');
    }
    const existing = await tx.billingAuditLog.findFirst({
      where: {
        actorUserIdSnapshot: input.actor.userId,
        action: 'BILLING_OPERATIONAL_CONTROL_CHANGED',
        targetType: 'BILLING_OPERATIONAL_CONTROL',
        targetId: environment,
        idempotencyKey: input.idempotencyKey,
      },
      select: { requestFingerprint: true, metadataRedacted: true },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      const prior = metadata(existing.metadataRedacted);
      return {
        environment: prior.environment,
        mode: prior.resultingMode,
        reason: prior.resultingReason,
        changedAt: new Date(prior.changedAt),
        version: prior.resultingVersion,
      };
    }
    if (control.version !== input.control.expectedVersion) {
      throw new ConflictError('El control operacional cambió; vuelve a cargar su estado');
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const resultingVersion = control.version + 1;
    const updated = await tx.billingOperationalControl.updateMany({
      where: { environment, version: control.version },
      data: {
        mode: input.control.mode,
        reason: input.control.reason,
        changedByAdminId: input.actor.userId,
        changedAt: now,
        version: resultingVersion,
      },
    });
    if (updated.count !== 1) throw new ConflictError('El control operacional cambió durante la actualización');
    if (control.mode === 'ENABLED' && input.control.mode !== 'ENABLED') {
      const pause = await tx.billingOperationalPause.create({
        data: {
          id: randomUUID(), environment, startedAt: now,
          startedByAdminId: input.actor.userId, reason: input.control.reason,
        },
      });
      await tx.billingAuditLog.create({
        data: {
          action: 'BILLING_MIGRATION_PAUSE_OPENED', actorType: 'USER',
          actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
          targetType: 'BILLING_OPERATIONAL_PAUSE', targetId: pause.id,
          requestId: input.actor.requestId, reason: input.control.reason,
          metadataRedacted: { environment },
        },
      });
    }
    if (control.mode !== 'ENABLED' && input.control.mode === 'ENABLED') {
      const pause = await tx.billingOperationalPause.findFirst({
        where: { environment, endedAt: null }, orderBy: { startedAt: 'asc' },
      });
      if (pause) {
        const extensionMilliseconds = Math.max(0, now.getTime() - pause.startedAt.getTime());
        const extensionSeconds = Math.ceil(extensionMilliseconds / 1_000);
        const migrations = extensionMilliseconds > 0
          ? await tx.billingMigrationAccess.findMany({
            where: {
              status: { in: ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'] },
              deadline: { gt: pause.startedAt },
            },
            select: { id: true, deadline: true, activatedAt: true },
          })
          : [];
        for (const migration of migrations) {
          if (!migration.deadline || !migration.activatedAt) continue;
          const intersectionStart = Math.max(pause.startedAt.getTime(), migration.activatedAt.getTime());
          const migrationExtensionMilliseconds = Math.max(0, now.getTime() - intersectionStart);
          if (migrationExtensionMilliseconds === 0) continue;
          const migrationExtensionSeconds = Math.ceil(migrationExtensionMilliseconds / 1_000);
          await tx.billingMigrationPauseApplication.create({
            data: {
              id: randomUUID(), billingMigrationAccessId: migration.id,
              billingOperationalPauseId: pause.id,
              extensionSeconds: migrationExtensionSeconds,
              extensionMilliseconds: BigInt(migrationExtensionMilliseconds),
              appliedAt: now,
            },
          });
          await tx.billingMigrationAccess.update({
            where: { id: migration.id },
            data: { deadline: new Date(migration.deadline.getTime() + migrationExtensionMilliseconds) },
          });
        }
        await tx.billingOperationalPause.update({
          where: { id: pause.id }, data: { endedAt: now, endedByAdminId: input.actor.userId },
        });
        await tx.billingAuditLog.create({
          data: {
            action: 'BILLING_MIGRATION_PAUSE_CLOSED', actorType: 'USER',
            actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
            targetType: 'BILLING_OPERATIONAL_PAUSE', targetId: pause.id,
            requestId: input.actor.requestId, reason: input.control.reason,
            metadataRedacted: { environment, extensionMilliseconds, migrationsExtended: migrations.length },
          },
        });
      }
    }
    const auditMetadata: ControlMetadata = {
      environment,
      previousMode: control.mode,
      resultingMode: input.control.mode,
      previousVersion: control.version,
      resultingVersion,
      resultingReason: input.control.reason,
      changedAt: now.toISOString(),
    };
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_OPERATIONAL_CONTROL_CHANGED',
        actorType: 'USER',
        actorUserId: input.actor.userId,
        actorUserIdSnapshot: input.actor.userId,
        targetType: 'BILLING_OPERATIONAL_CONTROL',
        targetId: environment,
        reason: input.control.reason,
        requestId: input.actor.requestId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        metadataRedacted: auditMetadata as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      environment,
      mode: input.control.mode,
      reason: input.control.reason,
      changedAt: now,
      version: resultingVersion,
    };
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
      if (result.mode === 'ENABLED') signalBackgroundJob('billing-migration-expiry');
      return result;
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') {
        throw new ConflictError('El control operacional cambió durante la actualización');
      }
      throw error;
    }
  }
  throw new ConflictError('El control operacional cambió durante la actualización');
}

export async function resolvePurchasesEnabled(
  environment: BillingEnvironment,
  catalogAvailable: boolean,
  client: Pick<PrismaClient, 'billingOperationalControl'> = prisma,
): Promise<boolean> {
  if (!env.BILLING_PURCHASES_ENABLED
    || !env.BILLING_REVENUECAT_ENABLED
    || !env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED
    || !env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED
    || (env.APP_ENV !== 'local' && !env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED)
    || !catalogAvailable) return false;
  try {
    const control = await client.billingOperationalControl.findUnique({
      where: { environment },
      select: { mode: true },
    });
    return control?.mode === 'ENABLED';
  } catch (cause) {
    logger.warn({
      event: 'billing.purchase_availability_failed_closed',
      environment,
      causeType: cause instanceof Error ? cause.name : typeof cause,
      causeCode: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined,
    }, 'Billing purchase availability failed closed');
    return false;
  }
}

export const operationalControlInternals = { fingerprint, metadata };

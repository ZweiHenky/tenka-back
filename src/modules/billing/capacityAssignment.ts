import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import type { DivisionCapacityAssignmentSource, Prisma, PrismaClient } from '../../generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { effectiveCapacityAt } from './effectiveCapacity';
import { acquireBillingAccountLock } from './service';

interface AssignDivisionCapacityInput {
  billingPeriodId: string;
  divisionId: string;
  assignmentSource: DivisionCapacityAssignmentSource;
  slotNumber?: number;
}

export async function assignDivisionCapacityInTransaction(
  tx: Prisma.TransactionClient,
  input: AssignDivisionCapacityInput,
) {
  await configureRawQuerySchema(tx);
  const periodIdentity = await tx.billingPeriod.findUnique({
    where: { id: input.billingPeriodId },
    select: { billingAccountId: true },
  });
  if (!periodIdentity) throw new NotFoundError('Periodo de billing');
  await acquireBillingAccountLock(tx, periodIdentity.billingAccountId);
  await tx.$queryRaw`SELECT "id" FROM billing_periods WHERE "id" = ${input.billingPeriodId} FOR UPDATE`;

  const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  const period = await tx.billingPeriod.findUnique({
    where: { id: input.billingPeriodId },
    select: {
      billingAccount: { select: { userId: true } },
      effectiveStart: true,
      effectiveEnd: true,
      endedEarlyAt: true,
      capacityAtStart: true,
      capacityGrants: {
        select: { id: true, effectiveAt: true, sequence: true, newCapacity: true },
      },
      assignments: { select: { slotNumber: true, divisionIdSnapshot: true } },
    },
  });
  if (!period) throw new NotFoundError('Periodo de billing');
  const effectiveEnd = period.endedEarlyAt ?? period.effectiveEnd;
  if (now < period.effectiveStart || now >= effectiveEnd) {
    throw new ValidationError('El periodo de billing no esta vigente');
  }
  const division = await tx.$queryRaw<Array<{
    id: string;
    nombre: string;
    leagueId: string;
    leagueName: string;
    ownerUserId: string;
  }>>`
    SELECT division."id", division."nombre", league."id" AS "leagueId",
      league."nombre" AS "leagueName", league."userId" AS "ownerUserId"
    FROM divisiones division
    JOIN ligas league ON league."id" = division."ligaId"
    WHERE division."id" = ${input.divisionId}
    FOR UPDATE OF division
  `;
  const target = division[0];
  if (!target) throw new NotFoundError('Division');
  if (!period.billingAccount.userId || target.ownerUserId !== period.billingAccount.userId) {
    throw new ValidationError('La division no pertenece a la cuenta de billing');
  }
  if (period.assignments.some(({ divisionIdSnapshot }) => divisionIdSnapshot === target.id)) {
    throw new ConflictError('La division ya tiene un slot en este periodo');
  }
  const capacity = effectiveCapacityAt(period.capacityAtStart, period.capacityGrants, now);
  const used = new Set(period.assignments.map(({ slotNumber }) => slotNumber));
  const slotNumber = input.slotNumber
    ?? Array.from({ length: capacity }, (_, index) => index + 1).find((slot) => !used.has(slot));
  if (!Number.isInteger(slotNumber) || !slotNumber || slotNumber > capacity || used.has(slotNumber)) {
    throw new ConflictError('No hay un slot disponible para la division');
  }
  const assignment = await tx.divisionCapacityAssignment.create({
    data: {
      billingPeriodId: input.billingPeriodId,
      slotNumber,
      divisionId: target.id,
      divisionIdSnapshot: target.id,
      divisionNameSnapshot: target.nombre,
      leagueIdSnapshot: target.leagueId,
      leagueNameSnapshot: target.leagueName,
      ownerUserIdSnapshot: target.ownerUserId,
      assignedAt: now,
      assignmentSource: input.assignmentSource,
    },
  });
  await tx.billingAuditLog.create({
    data: {
      action: 'BILLING_DIVISION_ASSIGNED',
      actorType: 'SYSTEM',
      actorUserIdSnapshot: 'billing-assignment',
      targetType: 'DivisionCapacityAssignment',
      targetId: assignment.id,
      requestId: randomUUID(),
      metadataRedacted: { slotNumber, assignmentSource: input.assignmentSource } satisfies Prisma.InputJsonObject,
    },
  });
  return assignment;
}

export async function assignDivisionCapacity(
  input: AssignDivisionCapacityInput,
  client: PrismaClient = prisma,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        (tx) => assignDivisionCapacityInTransaction(tx, input),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'P2034' && attempt < 2) continue;
      if (code === 'P2034' || code === 'P2002') {
        throw new ConflictError('La capacidad cambio durante la asignacion; vuelve a intentarlo');
      }
      throw error;
    }
  }
  throw new ConflictError('La capacidad cambio durante la asignacion; vuelve a intentarlo');
}

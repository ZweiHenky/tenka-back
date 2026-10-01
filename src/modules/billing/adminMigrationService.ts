import { prisma } from '../../config/database';
import {
  BillingMigrationAccessStatus,
  Prisma,
  type BillingAuditAction,
} from '../../generated/prisma/client';
import { NotFoundError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { currentBillingEnvironment } from './migrationLifecycleService';
import type { BillingMigrationAdminListQuery } from './adminMigrationValidator';

const ACTIVE_STATUSES: BillingMigrationAccessStatus[] = ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'];
const TIMELINE_ACTIONS: BillingAuditAction[] = [
  'BILLING_MIGRATION_PREPARED',
  'BILLING_MIGRATION_ACTIVATED',
  'BILLING_MIGRATION_FREE_DIVISION_SELECTED',
  'BILLING_MIGRATION_PURCHASED',
  'BILLING_MIGRATION_APPLIED',
];
const MIGRATION_SELECT = {
  id: true,
  billingAccountId: true,
  status: true,
  preparedAt: true,
  preparedDivisionCount: true,
  selectedFreeDivisionIdSnapshot: true,
  startedAt: true,
  deadline: true,
  activatedAt: true,
  appliedAt: true,
  createdAt: true,
  updatedAt: true,
  divisions: { select: { divisionId: true } },
  _count: { select: { pauseApplications: true } },
} satisfies Prisma.BillingMigrationAccessSelect;

interface AdminActor {
  userId: string;
  requestId: string;
}

async function auditRead(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  action: 'BILLING_MIGRATION_SUMMARY_VIEWED' | 'BILLING_MIGRATION_QUEUE_VIEWED' | 'BILLING_MIGRATION_DETAIL_VIEWED',
  targetId: string,
  metadataRedacted: Prisma.InputJsonValue,
): Promise<void> {
  await tx.billingAuditLog.create({
    data: {
      action,
      actorType: 'USER',
      actorUserId: actor.userId,
      actorUserIdSnapshot: actor.userId,
      targetType: action === 'BILLING_MIGRATION_DETAIL_VIEWED' ? 'BILLING_MIGRATION' : 'BILLING_MIGRATION_QUEUE',
      targetId,
      requestId: actor.requestId,
      metadataRedacted,
    },
  });
}

function safeTimelineMetadata(action: BillingAuditAction, value: Prisma.JsonValue): Record<string, boolean | number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const allowedByAction: Partial<Record<BillingAuditAction, string[]>> = {
    BILLING_MIGRATION_PREPARED: ['divisionCount'],
    BILLING_MIGRATION_ACTIVATED: ['migrationDays', 'capturedDivisions'],
    BILLING_MIGRATION_FREE_DIVISION_SELECTED: ['selected'],
    BILLING_MIGRATION_PURCHASED: ['paidAccessMaterialized'],
    BILLING_MIGRATION_APPLIED: ['grantCreated', 'paidAtDeadline'],
  };
  return Object.fromEntries((allowedByAction[action] ?? []).flatMap((key) => {
    const item = source[key];
    return typeof item === 'boolean' || typeof item === 'number' ? [[key, item]] : [];
  }));
}

function migrationListItem(
  migration: Prisma.BillingMigrationAccessGetPayload<{ select: typeof MIGRATION_SELECT }>,
  now: Date,
  openPause: { startedAt: Date } | null,
) {
  const liveDivisionCount = migration.divisions.filter(({ divisionId }) => divisionId !== null).length;
  const active = ACTIVE_STATUSES.includes(migration.status);
  const paused = Boolean(active && openPause && migration.deadline && migration.activatedAt
    && openPause.startedAt < migration.deadline && now >= migration.activatedAt);
  const overdue = Boolean(active && migration.deadline && migration.deadline <= now && !paused);
  const estimatedDeadlineAfterOpenPause = paused && migration.deadline && migration.activatedAt && openPause
    ? new Date(migration.deadline.getTime() + now.getTime()
      - Math.max(openPause.startedAt.getTime(), migration.activatedAt.getTime()))
    : null;
  const { divisions: _divisions, _count, ...record } = migration;
  return {
    ...record,
    liveDivisionCount,
    deletedDivisionCount: migration.divisions.length - liveDivisionCount,
    pauseApplicationCount: _count.pauseApplications,
    lifecyclePhase: paused ? 'PAUSED' : overdue ? 'OVERDUE_PENDING_APPLICATION' : active ? 'ACTIVE' : migration.status,
    remainingActiveMilliseconds: active && migration.deadline
      ? Math.max(0, migration.deadline.getTime() - (paused && openPause
        ? Math.max(openPause.startedAt.getTime(), migration.activatedAt!.getTime())
        : now.getTime())) : null,
    estimatedDeadlineAfterOpenPause,
  };
}

export async function getAdminBillingMigrationSummary(actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const [groups, openPause, liveDivisionSnapshotCount, deletedDivisionSnapshotCount] = await Promise.all([
      tx.billingMigrationAccess.groupBy({
        by: ['status'], _count: { _all: true }, _sum: { preparedDivisionCount: true },
      }),
      tx.billingOperationalPause.findFirst({
        where: { environment: currentBillingEnvironment(), endedAt: null }, select: { startedAt: true },
      }),
      tx.billingMigrationDivision.count({ where: { divisionId: { not: null } } }),
      tx.billingMigrationDivision.count({ where: { divisionId: null } }),
    ]);
    const byStatus = Object.fromEntries(
      Object.values(BillingMigrationAccessStatus).map((status) => [status, 0]),
    ) as Record<BillingMigrationAccessStatus, number>;
    let total = 0;
    let preparedDivisionCountTotal = 0;
    for (const group of groups) {
      byStatus[group.status] = group._count._all;
      total += group._count._all;
      preparedDivisionCountTotal += group._sum.preparedDivisionCount ?? 0;
    }
    const overdueDeadline = openPause ? { lte: openPause.startedAt } : { lte: now };
    const [overduePendingApplicationCount, pausedMigrationCount, activeDeadlines] = await Promise.all([
      tx.billingMigrationAccess.count({
        where: { status: { in: ACTIVE_STATUSES }, deadline: overdueDeadline },
      }),
      openPause ? tx.billingMigrationAccess.count({
        where: {
          status: { in: ACTIVE_STATUSES }, activatedAt: { lte: now }, deadline: { gt: openPause.startedAt },
        },
      }) : 0,
      tx.billingMigrationAccess.findMany({
        where: { status: { in: ACTIVE_STATUSES }, deadline: { not: null } },
        orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
        select: { deadline: true, activatedAt: true },
      }),
    ]);
    const result = {
      total,
      byStatus,
      activeLifecycleCount: ACTIVE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
      overduePendingApplicationCount,
      pausedMigrationCount,
      preparedDivisionCountTotal,
      liveDivisionSnapshotCount,
      deletedDivisionSnapshotCount,
      nextDeadlineAt: activeDeadlines.map((migration) => {
        if (!migration.deadline || !openPause || !migration.activatedAt
          || openPause.startedAt >= migration.deadline) return migration.deadline;
        return new Date(migration.deadline.getTime() + now.getTime()
          - Math.max(openPause.startedAt.getTime(), migration.activatedAt.getTime()));
      }).filter((deadline): deadline is Date => Boolean(deadline) && deadline! > now)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null,
      operationalPause: { active: Boolean(openPause), startedAt: openPause?.startedAt ?? null },
    };
    await auditRead(tx, actor, 'BILLING_MIGRATION_SUMMARY_VIEWED', 'all', {
      total, overduePendingApplicationCount,
    });
    return result;
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
}

export async function listAdminBillingMigrations(query: BillingMigrationAdminListQuery, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const openPause = await tx.billingOperationalPause.findFirst({
      where: { environment: currentBillingEnvironment(), endedAt: null }, select: { startedAt: true },
    });
    const deadline = query.deadline === 'OVERDUE' ? { lte: openPause?.startedAt ?? now }
      : query.deadline === 'UPCOMING' ? { gt: openPause?.startedAt ?? now }
        : query.deadline === 'NONE' ? null : undefined;
    const statuses = query.deadline && query.deadline !== 'NONE'
      ? query.status.filter((status) => ACTIVE_STATUSES.includes(status))
      : query.status;
    const rows = await tx.billingMigrationAccess.findMany({
      where: { status: { in: statuses }, ...(query.deadline ? { deadline } : {}) },
      select: MIGRATION_SELECT,
      orderBy: [{ preparedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = page.map((migration) => migrationListItem(migration, now, openPause));
    await auditRead(tx, actor, 'BILLING_MIGRATION_QUEUE_VIEWED', 'all', {
      statuses: query.status, deadline: query.deadline ?? null, resultCount: items.length,
    });
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
}

export async function getAdminBillingMigration(billingAccountId: string, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const [migration, openPause] = await Promise.all([
      tx.billingMigrationAccess.findUnique({
        where: { billingAccountId },
        select: {
          ...MIGRATION_SELECT,
          divisions: {
            orderBy: [{ divisionCreatedAtSnapshot: 'asc' }, { divisionIdSnapshot: 'asc' }],
            select: {
              id: true, divisionId: true, divisionIdSnapshot: true,
              divisionCreatedAtSnapshot: true, leagueIdSnapshot: true,
            },
          },
          pauseApplications: {
            orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true, billingOperationalPauseId: true, extensionSeconds: true,
              extensionMilliseconds: true, appliedAt: true,
              operationalPause: { select: { startedAt: true, endedAt: true } },
            },
          },
        },
      }),
      tx.billingOperationalPause.findFirst({
        where: { environment: currentBillingEnvironment(), endedAt: null }, select: { startedAt: true },
      }),
    ]);
    if (!migration) throw new NotFoundError('Preparación migratoria');
    const timeline = await tx.billingAuditLog.findMany({
      where: { targetType: 'BillingMigrationAccess', targetId: migration.id, action: { in: TIMELINE_ACTIONS } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, action: true, actorType: true, createdAt: true, metadataRedacted: true },
    });
    const listProjection = migrationListItem({
      ...migration,
      divisions: migration.divisions.map(({ divisionId }) => ({ divisionId })),
    }, now, openPause);
    const result = {
      ...listProjection,
      divisions: migration.divisions.map((snapshot) => ({
        id: snapshot.id,
        divisionIdSnapshot: snapshot.divisionIdSnapshot,
        divisionCreatedAtSnapshot: snapshot.divisionCreatedAtSnapshot,
        leagueIdSnapshot: snapshot.leagueIdSnapshot,
        attached: snapshot.divisionId !== null,
        selected: snapshot.divisionIdSnapshot === migration.selectedFreeDivisionIdSnapshot,
      })),
      pauseApplications: migration.pauseApplications.map((application) => ({
        id: application.id,
        operationalPauseId: application.billingOperationalPauseId,
        pauseStartedAt: application.operationalPause.startedAt,
        pauseEndedAt: application.operationalPause.endedAt,
        appliedAt: application.appliedAt,
        extensionMilliseconds: (application.extensionMilliseconds
          ?? BigInt(application.extensionSeconds) * 1_000n).toString(),
      })),
      auditTimeline: timeline.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorType: entry.actorType,
        createdAt: entry.createdAt,
        metadata: safeTimelineMetadata(entry.action, entry.metadataRedacted),
      })),
    };
    await auditRead(tx, actor, 'BILLING_MIGRATION_DETAIL_VIEWED', migration.id, {
      status: migration.status,
      capturedDivisionCount: migration.divisions.length,
      attachedDivisionCount: migration.divisions.filter(({ divisionId }) => divisionId !== null).length,
    });
    return result;
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
}

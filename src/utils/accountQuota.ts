import { prisma } from '../config/database';
import type { Prisma } from '../generated/prisma/client';
import type { UserRole } from '../types/auth';
import { AppError } from './errors';
import { acquireBillingAccountLock, acquireBillingOwnerBootstrapLock, resolveAccountAccessPolicy } from '../modules/billing/service';

export const ACTIVE_DIVISION_CODES = ['ABIERTA', 'EN_CURSO'] as const;

export type AccountQuotaResource = 'teams' | 'leagues' | 'divisions' | 'activeDivisions';

export interface AccountQuotaUsage {
  teams: number;
  leagues: number;
  divisions: number;
  activeDivisions: number;
}

export interface AccountQuota {
  role: UserRole;
  limits: Record<AccountQuotaResource, number | null>;
  usage: AccountQuotaUsage;
}

const QUOTA_ERRORS: Record<AccountQuotaResource, { code: string; message: string }> = {
  teams: { code: 'QUOTA_TEAMS_EXCEEDED', message: 'Has alcanzado el límite de equipos de tu cuenta' },
  leagues: { code: 'QUOTA_LEAGUES_EXCEEDED', message: 'Has alcanzado el límite de ligas de tu cuenta' },
  divisions: { code: 'QUOTA_DIVISIONS_EXCEEDED', message: 'Has alcanzado el límite de divisiones de tu cuenta' },
  activeDivisions: { code: 'QUOTA_ACTIVE_DIVISIONS_EXCEEDED', message: 'Has alcanzado el límite de divisiones activas de tu cuenta' },
};

type QuotaClient = Pick<Prisma.TransactionClient, 'user' | 'equipo' | 'liga' | 'division' | 'billingAccount'>;

export async function acquireAccountQuotaLock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const account = await tx.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (account) {
    await acquireBillingAccountLock(tx, account.id);
    return;
  }
  await acquireBillingOwnerBootstrapLock(tx, userId);
  const accountCreatedWhileWaiting = await tx.billingAccount.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (accountCreatedWhileWaiting) {
    await acquireBillingAccountLock(tx, accountCreatedWhileWaiting.id);
  }
}

export async function getAccountQuota(userId: string, client: QuotaClient = prisma): Promise<AccountQuota> {
  const policy = await resolveAccountAccessPolicy(userId, client);

  const [teams, leagues, divisions, activeDivisions] = await Promise.all([
    client.equipo.count({ where: { userId } }),
    client.liga.count({ where: { userId } }),
    client.division.count({ where: { liga: { userId } } }),
    client.division.count({
      where: { liga: { userId }, estadoLiga: { codigo: { in: [...ACTIVE_DIVISION_CODES] } } },
    }),
  ]);

  return {
    role: policy.role,
    limits: {
      teams: policy.ownedTeamLimit,
      leagues: policy.ownedLeagueLimit,
      divisions: policy.ownedDivisionLimit,
      activeDivisions: policy.activeDivisionLimit,
    },
    usage: { teams, leagues, divisions, activeDivisions },
  };
}

export async function assertAccountQuotaDelta(
  tx: Prisma.TransactionClient,
  userId: string,
  deltas: Partial<Record<AccountQuotaResource, number>>,
): Promise<AccountQuota> {
  const quota = await getAccountQuota(userId, tx);
  for (const resource of ['teams', 'leagues', 'divisions', 'activeDivisions'] as const) {
    const delta = deltas[resource] ?? 0;
    const limit = quota.limits[resource];
    if (delta <= 0 || limit === null || quota.usage[resource] + delta <= limit) continue;
    const error = QUOTA_ERRORS[resource];
    throw new AppError(422, error.message, error.code, {
      resource,
      limit,
      usage: quota.usage[resource],
      delta,
    });
  }
  return quota;
}

export function isActiveDivisionCode(code: string | null | undefined): boolean {
  return code === 'ABIERTA' || code === 'EN_CURSO';
}

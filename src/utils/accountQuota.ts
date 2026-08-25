import { prisma } from '../config/database';
import type { Prisma } from '../generated/prisma/client';
import type { UserRole } from '../types/auth';
import { AppError, NotFoundError } from './errors';

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

const LIMITS: Record<UserRole, AccountQuota['limits']> = {
  CAPITAN: { teams: 10, leagues: 0, divisions: 0, activeDivisions: 0 },
  LIGA: { teams: 40, leagues: 1, divisions: 1, activeDivisions: 1 },
  ADMINISTRADOR: { teams: null, leagues: null, divisions: null, activeDivisions: null },
};

const QUOTA_ERRORS: Record<AccountQuotaResource, { code: string; message: string }> = {
  teams: { code: 'QUOTA_TEAMS_EXCEEDED', message: 'Has alcanzado el límite de equipos de tu cuenta' },
  leagues: { code: 'QUOTA_LEAGUES_EXCEEDED', message: 'Has alcanzado el límite de ligas de tu cuenta' },
  divisions: { code: 'QUOTA_DIVISIONS_EXCEEDED', message: 'Has alcanzado el límite de divisiones de tu cuenta' },
  activeDivisions: { code: 'QUOTA_ACTIVE_DIVISIONS_EXCEEDED', message: 'Has alcanzado el límite de divisiones activas de tu cuenta' },
};

type QuotaClient = Pick<Prisma.TransactionClient, 'user' | 'equipo' | 'liga' | 'division'>;

export async function acquireAccountQuotaLock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `account-quota:${userId}`);
}

export async function getAccountQuota(userId: string, client: QuotaClient = prisma): Promise<AccountQuota> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');

  const [teams, leagues, divisions, activeDivisions] = await Promise.all([
    client.equipo.count({ where: { userId } }),
    client.liga.count({ where: { userId } }),
    client.division.count({ where: { liga: { userId } } }),
    client.division.count({
      where: { liga: { userId }, estadoLiga: { codigo: { in: [...ACTIVE_DIVISION_CODES] } } },
    }),
  ]);

  return {
    role: user.rol,
    limits: LIMITS[user.rol],
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

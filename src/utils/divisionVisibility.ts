import type { Prisma } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../types/auth';
import { prisma } from '../config/database';
import { NotFoundError } from './errors';

export function visibleDivisionWhere(actor?: AuthenticatedUser): Prisma.DivisionWhereInput {
  if (actor?.rol === 'ADMINISTRADOR') return {};
  const published = { estadoLiga: { nombre: { not: 'Borrador' } } };
  return actor ? { OR: [published, { liga: { userId: actor.id } }] } : published;
}

export async function assertVisibleDivision(
  divisionId: string,
  actor?: AuthenticatedUser,
): Promise<void> {
  const division = await prisma.division.findFirst({
    where: { id: divisionId, ...visibleDivisionWhere(actor) },
    select: { id: true },
  });
  if (!division) throw new NotFoundError('División');
}

import { NotFoundError } from '../../utils/errors';
import { premioRepository } from './repository';
import type { PremioEntity } from './entity';
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { assertVisibleDivision, visibleDivisionWhere } from '../../utils/divisionVisibility';
import type { Pagination } from '../../utils/pagination';

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
}

async function findForWrite(id: string, actor: AuthenticatedUser): Promise<PremioEntity> {
  const premio = await premioRepository.findById(id);
  if (!premio) throw new NotFoundError('Premio');
  await assertVisibleDivision(premio.divisionId, actor);
  return premio;
}

export const premioService = {
  async list(pagination: Pagination, actor?: AuthenticatedUser) {
    const where = { division: visibleDivisionWhere(actor) };
    const [rows, total] = await Promise.all([
      prisma.premio.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
      prisma.premio.count({ where }),
    ]);
    return { rows, total };
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<PremioEntity> {
    const t = await premioRepository.findVisibleById(id, actor);
    if (!t) throw new NotFoundError('Premio');
    return t;
  },

  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<PremioEntity[]> {
    const premios = await premioRepository.findVisibleByDivision(divisionId, actor);
    if (!premios) throw new NotFoundError('División');
    return premios;
  },

  async create(data: { posicion: number; titulo: string; monto?: number; descripcion?: string; divisionId: string }, actor: AuthenticatedUser): Promise<PremioEntity> {
    await assertDivisionOwner(data.divisionId, actor);
    return premioRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<PremioEntity> {
    const premio = await findForWrite(id, actor);
    await assertDivisionOwner(premio.divisionId, actor);
    return premioRepository.update(id, data);
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const premio = await findForWrite(id, actor);
    await assertDivisionOwner(premio.divisionId, actor);
    await premioRepository.delete(id);
  },
};

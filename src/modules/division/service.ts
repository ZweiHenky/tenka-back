import { NotFoundError } from '../../utils/errors';
import { divisionRepository } from './repository';
import type { DivisionEntity } from './entity';
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

async function assertLigaOwner(ligaId: string, actor: AuthenticatedUser): Promise<void> {
  const liga = await prisma.liga.findFirst({
    where: isAdmin(actor) ? { id: ligaId } : { id: ligaId, userId: actor.id },
    select: { id: true },
  });
  if (!liga) throw new NotFoundError('Liga');
}

async function assertDivisionOwner(id: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findFirst({
    where: isAdmin(actor) ? { id } : { id, liga: { userId: actor.id } },
    select: { id: true },
  });
  if (!division) throw new NotFoundError('Division');
}

export const divisionService = {
  async list(actor?: AuthenticatedUser): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: visibleDivisionWhere(actor), orderBy: { createdAt: 'desc' } });
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<DivisionEntity> {
    const division = await prisma.division.findFirst({
      where: { id, ...visibleDivisionWhere(actor) },
      include: { liga: { select: { id: true, nombre: true, logo: true } }, estadoLiga: { select: { id: true, nombre: true } } },
    }) as DivisionEntity | null;
    if (!division) throw new NotFoundError('Division');
    return division;
  },

  async listByLiga(ligaId: string, actor?: AuthenticatedUser): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: { ligaId, ...visibleDivisionWhere(actor) }, orderBy: { createdAt: 'desc' } });
  },

  async create(data: {
    nombre: string;
    maxEquipos: number;
    arbitraje?: number;
    diasPartido?: string;
    horarioPartido?: string;
    duracionPartido?: number;
    descanso?: number;
    fechaInicio?: Date;
    fechaFin?: Date;
    estadoLigaId?: string;
    ligaId: string;
    categoriaId: string;
    tipoId: string;
    tipoCompetenciaId: string;
  }, actor: AuthenticatedUser): Promise<DivisionEntity> {
    await assertLigaOwner(data.ligaId, actor);
    const estadoLigaId = data.estadoLigaId ?? (await prisma.estadoLiga.findFirstOrThrow({
      where: { nombre: 'Borrador' },
      select: { id: true },
    })).id;
    return divisionRepository.create({ ...data, estadoLigaId });
  },

  async update(id: string, data: Partial<DivisionEntity>, actor: AuthenticatedUser): Promise<DivisionEntity> {
    await assertDivisionOwner(id, actor);
    if (data.ligaId) await assertLigaOwner(data.ligaId, actor);
    return divisionRepository.update(id, data);
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(id, actor);

    await prisma.$transaction(async (tx) => {
      const subscriptions = await tx.divisionNotificationSubscription.findMany({
        where: { divisionId: id },
        select: { oneSignalId: true },
      });

      if (subscriptions.length) {
        const tag = `division_${id}`;
        await tx.oneSignalTagCleanupJob.createMany({
          data: subscriptions.map(({ oneSignalId }) => ({ oneSignalId, tag })),
          skipDuplicates: true,
        });
      }

      await divisionRepository.delete(id, tx);
    });
  },

  async resetDivision(divisionId: string, actor: AuthenticatedUser): Promise<void> {
    await assertDivisionOwner(divisionId, actor);

    await prisma.$transaction(async (tx) => {
      await tx.jornada.deleteMany({ where: { divisionId } });
      await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
      await tx.tablaPosicion.deleteMany({ where: { divisionId } });
    });
  },
};

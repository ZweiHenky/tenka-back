import { prisma } from '../../config/database';
import type { PartidoEntity } from './entity';
import type { PartidoRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export const exposeAnotacionRead = (anotacion: any) => ({
  id: anotacion.id,
  ladoMarcador: anotacion.ladoMarcador,
  cantidad: anotacion.cantidad,
  jugadorId: anotacion.jugadorId ?? anotacion.jugadorIdSnapshot ?? null,
  equipoId: anotacion.equipoId ?? anotacion.equipoIdSnapshot ?? null,
  jugadorNombre: anotacion.jugadorNombre ?? null,
  equipoNombre: anotacion.equipoNombre ?? null,
  dorsal: anotacion.dorsal ?? null,
});

export const exposeParticipacionRead = (participacion: any) => ({
  id: participacion.id,
  ladoMarcador: participacion.ladoMarcador,
  jugadorId: participacion.jugadorId ?? participacion.jugadorIdSnapshot ?? null,
  equipoId: participacion.equipoId ?? participacion.equipoIdSnapshot ?? null,
  jugadorNombre: participacion.jugadorNombre,
  equipoNombre: participacion.equipoNombre,
  dorsal: participacion.dorsal ?? null,
});

export const exposePartidoRead = (partido: any): PartidoEntity => {
  const { notas: _notas, jornada: _jornada, rondaPlayoff: _rondaPlayoff, ...publicPartido } = partido;
  return {
    ...publicPartido,
    timeZone: partido.jornada?.division?.liga?.timeZone ?? partido.rondaPlayoff?.division?.liga?.timeZone,
    arbitros: partido.arbitros?.map((row: any) => row.arbitro),
    anotaciones: partido.anotaciones?.map(exposeAnotacionRead),
    participaciones: partido.participaciones?.map(exposeParticipacionRead),
  };
};

export const exposePartidoReadWithNotas = (partido: any): PartidoEntity => {
  const { jornada: _jornada, rondaPlayoff: _rondaPlayoff, ...rest } = partido;
  return {
    ...rest,
    timeZone: partido.jornada?.division?.liga?.timeZone ?? partido.rondaPlayoff?.division?.liga?.timeZone,
    arbitros: partido.arbitros?.map((row: any) => row.arbitro),
    anotaciones: partido.anotaciones?.map(exposeAnotacionRead),
    participaciones: partido.participaciones?.map(exposeParticipacionRead),
  };
};

const PARTIDO_OWNER_CONTEXT = {
  jornada: { select: { division: { select: { liga: { select: { userId: true, timeZone: true } } } } } },
  rondaPlayoff: { select: { division: { select: { liga: { select: { userId: true, timeZone: true } } } } } },
} as const;

function isPartidoOwner(partido: any, actor?: AuthenticatedUser): boolean {
  if (!actor) return false;
  if (actor.rol === 'ADMINISTRADOR') return true;
  const ligaUserId = partido.jornada?.division?.liga?.userId ?? partido.rondaPlayoff?.division?.liga?.userId;
  return ligaUserId === actor.id;
}

export const PARTIDO_READ_INCLUDE = {
  equipoLocal: { select: { id: true, nombre: true, logo: true } },
  equipoVisitante: { select: { id: true, nombre: true, logo: true } },
  cancha: { select: { id: true, nombre: true } },
  arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
} as const;

const PARTIDO_DETAIL_INCLUDE = {
  ...PARTIDO_READ_INCLUDE,
  ...PARTIDO_OWNER_CONTEXT,
  anotaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
  participaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.PartidoInclude;

export const partidoRepository: PartidoRepository = {
  async findAuthorizationContext(id: string, client: PrismaClient | Prisma.TransactionClient = prisma) {
    const partido = await client.partido.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        estado: true,
        golesLocal: true,
        golesVisitante: true,
        penalesLocal: true,
        penalesVisitante: true,
        fecha: true,
        fechaFin: true,
        canchaId: true,
        tipoPartido: true,
        equipoLocalId: true,
        equipoVisitanteId: true,
        jornadaId: true,
        rondaPlayoffId: true,
        jornada: { select: { division: { select: { id: true, ligaId: true, liga: { select: { userId: true, multiplesCanchas: true } } } } } },
        rondaPlayoff: { select: { division: { select: { id: true, ligaId: true, liga: { select: { userId: true, multiplesCanchas: true } } } } } },
      },
    })
    if (!partido) return null
    const division = partido.jornada?.division ?? partido.rondaPlayoff?.division
    return {
      id: partido.id,
      version: partido.version,
      ligaUserId: division?.liga.userId ?? '',
      ligaId: division?.ligaId ?? '',
      estado: partido.estado,
      golesLocal: partido.golesLocal,
      golesVisitante: partido.golesVisitante,
      penalesLocal: partido.penalesLocal,
      penalesVisitante: partido.penalesVisitante,
      jornadaId: partido.jornadaId,
      rondaPlayoffId: partido.rondaPlayoffId,
      divisionId: division?.id ?? null,
      tipoPartido: partido.tipoPartido,
      equipoLocalId: partido.equipoLocalId,
      equipoVisitanteId: partido.equipoVisitanteId,
      fecha: partido.fecha,
      fechaFin: partido.fechaFin,
      canchaId: partido.canchaId,
      multiplesCanchas: division?.liga.multiplesCanchas ?? false,
    }
  },

  async findAllVisible(actor?: AuthenticatedUser): Promise<PartidoEntity[]> {
    const divisionWhere = visibleDivisionWhere(actor);
    const partidos = await prisma.partido.findMany({
      where: {
        OR: [
          { jornada: { division: divisionWhere } },
          { rondaPlayoff: { division: divisionWhere } },
        ],
      },
      include: PARTIDO_READ_INCLUDE,
    });
    return partidos.map(exposePartidoRead);
  },

  async findAllVisiblePaginated({ skip, take }, actor?: AuthenticatedUser): Promise<{ rows: PartidoEntity[]; total: number }> {
    const divisionWhere = visibleDivisionWhere(actor);
    const where = {
        OR: [
          { jornada: { division: divisionWhere } },
          { rondaPlayoff: { division: divisionWhere } },
        ],
      };
    const [partidos, total] = await Promise.all([
      prisma.partido.findMany({ where, include: PARTIDO_READ_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.partido.count({ where }),
    ]);
    return { rows: partidos.map(exposePartidoRead), total };
  },

  async findById(id: string): Promise<PartidoEntity | null> {
    const partido = await prisma.partido.findUnique({
      where: { id },
      include: PARTIDO_DETAIL_INCLUDE,
    });
    return partido ? exposePartidoRead(partido) : null;
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<PartidoEntity | null> {
    const divisionWhere = visibleDivisionWhere(actor);
    const partido = await prisma.partido.findFirst({
      where: {
        id,
        OR: [
          { jornada: { division: divisionWhere } },
          { rondaPlayoff: { division: divisionWhere } },
        ],
      },
      include: PARTIDO_DETAIL_INCLUDE,
    });
    return partido
      ? (isPartidoOwner(partido, actor) ? exposePartidoReadWithNotas(partido) : exposePartidoRead(partido))
      : null;
  },

  async findByJornada(jornadaId: string): Promise<PartidoEntity[]> {
    const partidos = await prisma.partido.findMany({
      where: { jornadaId },
      include: PARTIDO_READ_INCLUDE,
    });
    return partidos.map(exposePartidoRead);
  },

  async findVisibleByJornada(jornadaId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null> {
    const jornada = await prisma.jornada.findFirst({
      where: { id: jornadaId, division: visibleDivisionWhere(actor) },
      select: { partidos: { include: PARTIDO_READ_INCLUDE } },
    });
    return jornada ? jornada.partidos.map(exposePartidoRead) : null;
  },

  async findByRondaPlayoff(rondaPlayoffId: string): Promise<PartidoEntity[]> {
    const partidos = await prisma.partido.findMany({
      where: { rondaPlayoffId },
      include: PARTIDO_READ_INCLUDE,
    });
    return partidos.map(exposePartidoRead);
  },

  async findVisibleByRondaPlayoff(rondaPlayoffId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[] | null> {
    const ronda = await prisma.rondaPlayoff.findFirst({
      where: { id: rondaPlayoffId, division: visibleDivisionWhere(actor) },
      select: { partidos: { include: PARTIDO_READ_INCLUDE } },
    });
    return ronda ? ronda.partidos.map(exposePartidoRead) : null;
  },

  async create(data: Record<string, unknown>): Promise<PartidoEntity> {
    return prisma.partido.create({ data: data as any });
  },

  async update(id: string, data: Record<string, unknown>, client: PrismaClient | Prisma.TransactionClient = prisma): Promise<PartidoEntity> {
    const partido = await client.partido.update({
      where: { id },
      data,
      include: PARTIDO_READ_INCLUDE,
    });
    return exposePartidoRead(partido);
  },

  async delete(id: string, client: PrismaClient | Prisma.TransactionClient = prisma): Promise<PartidoEntity> {
    const partido = await client.partido.delete({ where: { id }, include: PARTIDO_READ_INCLUDE });
    return exposePartidoRead(partido);
  },
};

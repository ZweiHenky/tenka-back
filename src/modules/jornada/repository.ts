import { prisma } from '../../config/database';
import type { JornadaEntity } from './entity';
import type { JornadaRepository, PaginatedResult } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

const exposeArbitros = (jornada: any): JornadaEntity => {
  const { generationKey: _generationKey, generationRequestHash: _generationRequestHash, ...publicJornada } = jornada;
  return {
    ...publicJornada,
    partidos: jornada.partidos?.map((partido: any) => {
      const { notas: _notas, ...publicPartido } = partido;
      return { ...publicPartido, arbitros: partido.arbitros?.map((row: any) => row.arbitro) };
    }),
  };
};

const partidosInclude = {
  orderBy: { fecha: 'asc' as const },
  include: {
    equipoLocal: { select: { id: true, nombre: true, logo: true } },
    equipoVisitante: { select: { id: true, nombre: true, logo: true } },
    cancha: { select: { id: true, nombre: true } },
    arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
  },
};

export const jornadaRepository: JornadaRepository = {
  async findAll(): Promise<JornadaEntity[]> {
    return (await prisma.jornada.findMany()).map(exposeArbitros);
  },

  async findById(id: string): Promise<JornadaEntity | null> {
    const jornada = await prisma.jornada.findUnique({
      where: { id },
      include: { partidos: partidosInclude },
    });
    return jornada ? exposeArbitros(jornada) : null;
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<JornadaEntity | null> {
    const jornada = await prisma.jornada.findFirst({
      where: { id, division: visibleDivisionWhere(actor) },
      include: { partidos: partidosInclude },
    });
    return jornada ? exposeArbitros(jornada) : null;
  },

  async findByDivision(divisionId: string, options?: { skip?: number; take?: number }): Promise<PaginatedResult<JornadaEntity>> {
    const [rows, total] = await Promise.all([
      prisma.jornada.findMany({
        where: { divisionId },
        orderBy: { numero: 'desc' },
        skip: options?.skip,
        take: options?.take,
        include: { partidos: partidosInclude },
      }),
      prisma.jornada.count({ where: { divisionId } }),
    ]);
    return { rows: rows.map(exposeArbitros), total };
  },

  async findGenerationHistory(divisionId, client) {
    return (client ?? prisma).jornada.findMany({
      where: { divisionId },
      orderBy: { numero: 'desc' },
      select: {
        id: true,
        numero: true,
        fechaInicio: true,
        partidos: {
          select: {
            id: true,
            equipoLocalId: true,
            equipoVisitanteId: true,
            tipoPartido: true,
            fecha: true,
          },
        },
      },
    });
  },

  async findVisibleByDivision(divisionId: string, options?: { skip?: number; take?: number }, actor?: AuthenticatedUser): Promise<PaginatedResult<JornadaEntity> | null> {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: {
        jornadas: {
          orderBy: { numero: 'desc' },
          skip: options?.skip,
          take: options?.take,
          include: { partidos: partidosInclude },
        },
        _count: { select: { jornadas: true } },
      },
    });
    if (!division) return null;
    return { rows: division.jornadas.map(exposeArbitros), total: division._count.jornadas };
  },

  async findDeleteContext(id: string, actor: AuthenticatedUser, client) {
    const jornada = await (client ?? prisma).jornada.findFirst({
      where: actor.rol === 'ADMINISTRADOR'
        ? { id }
        : { id, division: { liga: { userId: actor.id } } },
      select: {
        divisionId: true,
        division: {
          select: {
            ligaId: true,
            liga: { select: { userId: true } },
            jornadas: {
              orderBy: { numero: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        },
        partidos: {
          where: {
            OR: [
              { estado: 'FINALIZADO' },
              { rondaPlayoffId: { not: null }, llave: { not: null } },
            ],
          },
          select: { id: true, estado: true, rondaPlayoffId: true, llave: true },
        },
      },
    });
    if (!jornada) return null;

    return {
      divisionId: jornada.divisionId,
      ligaId: jornada.division.ligaId,
      ligaUserId: jornada.division.liga.userId,
      latestJornadaId: jornada.division.jornadas[0]?.id ?? null,
      hasFinalizados: jornada.partidos.some((partido) => partido.estado === 'FINALIZADO'),
      playoffPartidos: jornada.partidos
        .filter((partido): partido is typeof partido & { rondaPlayoffId: string; llave: number } => (
          partido.rondaPlayoffId !== null && partido.llave !== null
        ))
        .map(({ id: partidoId, rondaPlayoffId, llave }) => ({ id: partidoId, rondaPlayoffId, llave })),
    };
  },

  async delete(id: string): Promise<void> {
    await prisma.jornada.delete({ where: { id } });
  },
};

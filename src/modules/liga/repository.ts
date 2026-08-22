import { prisma } from '../../config/database';
import type { LigaEntity, ProgramacionRecienteLigaDto, PublicLeagueListDto, UserLeagueListDto } from './entity';
import type { LigaRepository, LigaFilterParams, LigaCreateData, LigaCanchaWrite, LigaWriteData } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import type { Prisma } from '../../generated/prisma/client';

const UBICACION_SELECT = {
  select: { id: true, nombreCompleto: true, estado: true, municipio: true, lat: true, lng: true, timeZone: true },
} as const;

const CANCHAS_SELECT = {
  select: { id: true, nombre: true, nombreNormalizado: true, activa: true, createdAt: true, updatedAt: true, ligaId: true },
} as const;

const CANCHAS_PUBLIC_SELECT = {
  where: { activa: true },
  select: CANCHAS_SELECT.select,
} as const;

const ARBITROS_SELECT = {
  select: { id: true, nombre: true, activo: true, createdAt: true, updatedAt: true, ligaId: true },
} as const;

function toLigaEntity<T>(row: T): LigaEntity {
  return row as unknown as LigaEntity;
}

function toLigaEntityList<T>(rows: PromiseLike<T[]> | T[]): Promise<LigaEntity[]> {
  return Promise.resolve(rows).then((r) => r as unknown as LigaEntity[]);
}

const PUBLIC_DIVISION_WHERE = { estadoLiga: { codigo: { not: 'BORRADOR' } } } as const;

const USER_LEAGUE_LIST_SELECT = {
  id: true,
  nombre: true,
  logo: true,
} as const;

const PUBLIC_LEAGUE_LIST_SELECT = {
  ...USER_LEAGUE_LIST_SELECT,
  descripcion: true,
  cancha: true,
  ubicacionId: true,
  divisiones: {
    where: PUBLIC_DIVISION_WHERE,
    select: {
      id: true,
      nombre: true,
      maxEquipos: true,
      arbitraje: true,
      diasPartido: true,
      horarioPartido: true,
      // Los escalares son el resumen (unión). Las filas son la configuración real, y con el
      // nombre de la cancha la vista pública puede mostrar el desglose sin otra consulta.
      canchaHorarios: {
        select: { canchaId: true, diasPartido: true, horarioPartido: true, cancha: { select: { nombre: true } } },
      },
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
    },
  },
} as const;

const DIVISION_RELATIONS = {
  canchaHorarios: {
    select: { canchaId: true, diasPartido: true, horarioPartido: true, cancha: { select: { nombre: true } } },
  },
  categoria: { select: { id: true, nombre: true } },
  tipo: { select: { id: true, nombre: true } },
  estadoLiga: { select: { id: true, nombre: true } },
  // `codigo` es lo que decide el formato en la app; el nombre del catálogo es editable.
  tipoCompetencia: { select: { id: true, nombre: true, codigo: true } },
} as const;

const DIVISIONES_INCLUDE = {
  ubicacion: UBICACION_SELECT,
  divisiones: {
    include: {
      // El detalle también muestra el desglose por cancha; los escalares son solo su resumen.
      canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } },
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
    },
  },
  canchas: CANCHAS_SELECT,
  arbitros: ARBITROS_SELECT,
} as const;

const DIVISIONES_INCLUDE_PUBLIC = {
  ubicacion: UBICACION_SELECT,
  user: {
    select: { name: true, phoneNumber: true, showPhoneInPublicLeague: true },
  },
  divisiones: {
    where: PUBLIC_DIVISION_WHERE,
    include: {
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
    },
  },
  canchas: CANCHAS_PUBLIC_SELECT,
  arbitros: ARBITROS_SELECT,
} as const;

const BASE_INCLUDE = {
  ubicacion: UBICACION_SELECT,
  user: {
    select: { name: true, phoneNumber: true, showPhoneInPublicLeague: true },
  },
  divisiones: {
    include: {
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
    },
  },
  canchas: CANCHAS_SELECT,
  arbitros: ARBITROS_SELECT,
} as const;

export const ligaRepository: LigaRepository = {
  async findAll(): Promise<PublicLeagueListDto[]> {
    return prisma.liga.findMany({
        where: { divisiones: { some: PUBLIC_DIVISION_WHERE } },
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_LEAGUE_LIST_SELECT,
      });
  },

  async findById(id: string): Promise<LigaEntity | null> {
    return toLigaEntity(
      prisma.liga.findUnique({
        where: { id },
        include: DIVISIONES_INCLUDE,
      }),
    );
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<LigaEntity | null> {
    const isAdmin = actor?.rol === 'ADMINISTRADOR';
    const where = isAdmin
      ? { id }
      : actor
        ? { id, OR: [{ userId: actor.id }, { divisiones: { some: PUBLIC_DIVISION_WHERE } }] }
        : { id, divisiones: { some: PUBLIC_DIVISION_WHERE } };
    const divisionWhere = isAdmin ? undefined : PUBLIC_DIVISION_WHERE;
    const canchas = isAdmin
      ? CANCHAS_SELECT
      : actor
        ? { ...CANCHAS_SELECT, where: { OR: [{ activa: true }, { liga: { userId: actor.id } }] } }
        : CANCHAS_PUBLIC_SELECT;

    const liga = await prisma.liga.findFirst({
      where,
      include: {
        ubicacion: UBICACION_SELECT,
        user: isAdmin ? false : DIVISIONES_INCLUDE_PUBLIC.user,
        divisiones: { where: divisionWhere, include: DIVISION_RELATIONS },
        canchas,
        arbitros: ARBITROS_SELECT,
      },
    });

    // Keep the established managed-detail response, which does not expose the user relation.
    if (liga && actor && liga.userId === actor.id) delete (liga as LigaEntity).user;
    return toLigaEntity(liga);
  },

  async findPublicById(id: string): Promise<LigaEntity | null> {
    return toLigaEntity(
      prisma.liga.findFirst({
        where: { id, divisiones: { some: PUBLIC_DIVISION_WHERE } },
        include: DIVISIONES_INCLUDE_PUBLIC,
      }),
    );
  },

  async findUpdateContext(id: string, actor: AuthenticatedUser) {
    return prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
      select: {
        logo: true,
        logoPublicId: true,
        cancha: true,
        canchaPublicId: true,
        multiplesCanchas: true,
        usaArbitros: true,
        canchas: { select: { id: true, nombre: true, nombreNormalizado: true, activa: true } },
        arbitros: { where: { activo: true }, select: { nombre: true } },
      },
    });
  },

  async findDeleteContext(id: string, actor: AuthenticatedUser) {
    return prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
      select: { nombre: true, logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
    });
  },

  async findManagementContext(id: string, actor: AuthenticatedUser) {
    return prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
      select: { multiplesCanchas: true, usaArbitros: true },
    });
  },

  async findManageableCanchas(ligaId: string, actor: AuthenticatedUser) {
    const liga = await prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
      select: { canchas: CANCHAS_SELECT },
    });
    return liga?.canchas ?? null;
  },

  async findManageableArbitros(ligaId: string, actor: AuthenticatedUser) {
    const liga = await prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
      select: { arbitros: ARBITROS_SELECT },
    });
    return liga?.arbitros ?? null;
  },

  async findRecentSchedule(ligaId: string, actor: AuthenticatedUser): Promise<ProgramacionRecienteLigaDto | null> {
    const liga = await prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
      select: {
        id: true,
        nombre: true,
        multiplesCanchas: true,
        divisiones: {
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            nombre: true,
            categoria: { select: { id: true, nombre: true } },
            jornadas: {
              orderBy: [{ numero: 'desc' }, { id: 'asc' }],
              take: 1,
              select: {
                id: true,
                numero: true,
                fechaInicio: true,
                fechaFin: true,
                partidos: {
                  orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    fecha: true,
                    fechaFin: true,
                    equipoLocal: { select: { id: true, nombre: true, logo: true } },
                    equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                    cancha: { select: { id: true, nombre: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!liga) return null;
    return liga;
  },

  async findByNormalizedName(nombreNormalizado: string, excludeId?: string): Promise<{ id: string } | null> {
    return prisma.liga.findFirst({
      where: { nombreNormalizado, id: excludeId ? { not: excludeId } : undefined },
      select: { id: true },
    });
  },

  async findByUser(userId: string): Promise<UserLeagueListDto[]> {
    return prisma.liga.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: USER_LEAGUE_LIST_SELECT });
  },

  async findPublicByUser(userId: string): Promise<PublicLeagueListDto[]> {
    return prisma.liga.findMany({
        where: { userId, divisiones: { some: PUBLIC_DIVISION_WHERE } },
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_LEAGUE_LIST_SELECT,
      });
  },

  async findAllPaginated({ page, limit, search, categoriaId, tipoId, estadoLigaId }: LigaFilterParams) {
    const divisionFilters: Record<string, unknown>[] = [];
    if (categoriaId) divisionFilters.push({ categoriaId });
    if (tipoId) divisionFilters.push({ tipoId });
    if (estadoLigaId) divisionFilters.push({ estadoLigaId });

    const borradorFilter = PUBLIC_DIVISION_WHERE;
    if (divisionFilters.length > 0) {
      divisionFilters.push(borradorFilter);
    }

    const where: Prisma.LigaWhereInput = {};
    if (search) where.nombre = { contains: search, mode: 'insensitive' };
    if (divisionFilters.length > 0) {
      where.divisiones = { some: { AND: divisionFilters } };
    } else {
      where.divisiones = { some: borradorFilter };
    }

    const [rows, total] = await Promise.all([
      prisma.liga.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: PUBLIC_LEAGUE_LIST_SELECT,
      }),
      prisma.liga.count({ where }),
    ]);
    return { rows, total };
  },

  async create(data: LigaCreateData, canchas?: LigaCanchaWrite[], arbitros?: { nombre: string }[], tx?: Prisma.TransactionClient): Promise<LigaEntity> {
    return toLigaEntity(
      (tx ?? prisma).liga.create({
        data: {
          ...data,
          canchas: canchas ? {
            create: canchas.map(({ nombre, nombreNormalizado, activa }) => ({ nombre, nombreNormalizado, activa })),
          } : undefined,
          arbitros: arbitros ? { create: arbitros } : undefined,
        },
        include: BASE_INCLUDE,
      }),
    );
  },

  async update(id: string, data: LigaWriteData, canchas?: LigaCanchaWrite[], arbitros?: { nombre: string }[], clearDivisionCourts?: boolean, transaction?: Prisma.TransactionClient): Promise<LigaEntity> {
    const execute = async (tx: Prisma.TransactionClient) => {
      if (clearDivisionCourts) {
        // Per-court schedules are meaningless once the league runs a single court.
        await tx.divisionCanchaHorario.deleteMany({ where: { division: { ligaId: id } } });
      }
      if (canchas) {
        const renamed = canchas.filter((cancha) =>
          cancha.id && cancha.nombreNormalizadoAnterior !== cancha.nombreNormalizado,
        );
        for (const cancha of renamed) {
          await tx.ligaCancha.update({
            where: { id: cancha.id },
            data: { nombreNormalizado: `__liga_cancha_tmp_${cancha.id}` },
          });
        }
        for (const cancha of canchas) {
          if (cancha.id) {
            await tx.ligaCancha.update({
              where: { id: cancha.id },
              data: {
                nombre: cancha.nombre,
                nombreNormalizado: cancha.nombreNormalizado,
                activa: cancha.activa,
              },
            });
          } else {
            await tx.ligaCancha.create({
              data: {
                ligaId: id,
                nombre: cancha.nombre,
                nombreNormalizado: cancha.nombreNormalizado,
                activa: cancha.activa,
              },
            });
          }
        }
      }
      if (arbitros) {
        await tx.ligaArbitro.deleteMany({ where: { ligaId: id } });
        await tx.ligaArbitro.createMany({ data: arbitros.map((arbitro) => ({ ...arbitro, ligaId: id })) });
      }
      return toLigaEntity(
        tx.liga.update({
          where: { id },
          data: data as Prisma.LigaUncheckedUpdateInput,
          include: BASE_INCLUDE,
        }),
      );
    };
    return transaction ? execute(transaction) : prisma.$transaction(execute);
  },

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? prisma).liga.delete({ where: { id } });
  },
};

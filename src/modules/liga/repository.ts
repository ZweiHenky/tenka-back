import { prisma } from '../../config/database';
import type { LigaEntity, ProgramacionRecienteLigaDto } from './entity';
import type { LigaRepository, LigaFilterParams } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';

const UBICACION_SELECT = {
  select: { id: true, nombreCompleto: true, estado: true, municipio: true, lat: true, lng: true },
} as const;

const CACHAS_SELECT = {
  select: { id: true, nombre: true, activa: true, createdAt: true, updatedAt: true, ligaId: true },
} as const;

const ARBITROS_SELECT = {
  select: { id: true, nombre: true, activo: true, createdAt: true, updatedAt: true, ligaId: true },
} as const;

const PUBLIC_DIVISION_WHERE = { estadoLiga: { nombre: { not: 'Borrador' } } } as const;

const DIVISION_RELATIONS = {
  categoria: { select: { id: true, nombre: true } },
  tipo: { select: { id: true, nombre: true } },
  estadoLiga: { select: { id: true, nombre: true } },
  tipoCompetencia: { select: { id: true, nombre: true } },
} as const;

const DIVISIONES_INCLUDE = {
  ubicacion: UBICACION_SELECT,
  divisiones: {
    include: {
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
    },
  },
  canchas: CACHAS_SELECT,
  arbitros: ARBITROS_SELECT,
} as const;

const DIVISIONES_INCLUDE_PUBLIC = {
  ubicacion: UBICACION_SELECT,
  user: {
    select: { name: true, phoneNumber: true, showPhoneInPublicLeague: true },
  },
  divisiones: {
    where: { estadoLiga: { nombre: { not: "Borrador" } } },
    include: {
      categoria: { select: { id: true, nombre: true } },
      tipo: { select: { id: true, nombre: true } },
      estadoLiga: { select: { id: true, nombre: true } },
      tipoCompetencia: { select: { id: true, nombre: true } },
    },
  },
  canchas: CACHAS_SELECT,
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
  canchas: CACHAS_SELECT,
  arbitros: ARBITROS_SELECT,
} as const;

export const ligaRepository: LigaRepository = {
  async findAll(): Promise<LigaEntity[]> {
    return prisma.liga.findMany({
      where: { divisiones: { some: { estadoLiga: { nombre: { not: "Borrador" } } } } },
      orderBy: { createdAt: 'desc' },
      include: DIVISIONES_INCLUDE_PUBLIC,
    });
  },

  async findById(id: string): Promise<LigaEntity | null> {
    return prisma.liga.findUnique({
      where: { id },
      include: DIVISIONES_INCLUDE,
    });
  },

  async findVisibleById(id: string, actor?: AuthenticatedUser): Promise<LigaEntity | null> {
    const isAdmin = actor?.rol === 'ADMINISTRADOR';
    const where = isAdmin
      ? { id }
      : actor
        ? { id, OR: [{ userId: actor.id }, { divisiones: { some: PUBLIC_DIVISION_WHERE } }] }
        : { id, divisiones: { some: PUBLIC_DIVISION_WHERE } };
    const divisionWhere = isAdmin
      ? undefined
      : actor
        ? { OR: [PUBLIC_DIVISION_WHERE, { liga: { userId: actor.id } }] }
        : PUBLIC_DIVISION_WHERE;

    const liga = await prisma.liga.findFirst({
      where,
      include: {
        ubicacion: UBICACION_SELECT,
        user: isAdmin ? false : DIVISIONES_INCLUDE_PUBLIC.user,
        divisiones: { where: divisionWhere, include: DIVISION_RELATIONS },
        canchas: CACHAS_SELECT,
        arbitros: ARBITROS_SELECT,
      },
    });

    // Keep the established managed-detail response, which does not expose the user relation.
    if (liga && actor && liga.userId === actor.id) delete (liga as LigaEntity).user;
    return liga;
  },

  async findPublicById(id: string): Promise<LigaEntity | null> {
    return prisma.liga.findFirst({
      where: { id, divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
      include: DIVISIONES_INCLUDE_PUBLIC,
    });
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
        canchas: { where: { activa: true }, select: { nombre: true } },
        arbitros: { where: { activo: true }, select: { nombre: true } },
      },
    });
  },

  async findDeleteContext(id: string, actor: AuthenticatedUser) {
    return prisma.liga.findFirst({
      where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
      select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
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
      select: { canchas: CACHAS_SELECT },
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

  async findByUser(userId: string): Promise<LigaEntity[]> {
    return prisma.liga.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: DIVISIONES_INCLUDE });
  },

  async findPublicByUser(userId: string): Promise<LigaEntity[]> {
    return prisma.liga.findMany({
      where: { userId, divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
      orderBy: { createdAt: 'desc' },
      include: DIVISIONES_INCLUDE_PUBLIC,
    });
  },

  async findAllPaginated({ page, limit, search, categoriaId, tipoId, estadoLigaId }: LigaFilterParams) {
    const divisionFilters: Record<string, unknown>[] = [];
    if (categoriaId) divisionFilters.push({ categoriaId });
    if (tipoId) divisionFilters.push({ tipoId });
    if (estadoLigaId) divisionFilters.push({ estadoLigaId });

    const borradorFilter = { estadoLiga: { nombre: { not: "Borrador" } } };
    if (divisionFilters.length > 0) {
      divisionFilters.push(borradorFilter);
    }

    const where: Record<string, unknown> = {};
    if (search) where.nombre = { contains: search, mode: 'insensitive' };
    if (divisionFilters.length > 0) {
      where.divisiones = { some: { AND: divisionFilters } };
    } else {
      where.divisiones = { some: borradorFilter };
    }

    const [rows, total] = await Promise.all([
      prisma.liga.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: DIVISIONES_INCLUDE_PUBLIC,
      }),
      prisma.liga.count({ where: where as any }),
    ]);
    return { rows, total };
  },

  async create(data: Record<string, unknown>, canchas?: { nombre: string }[], arbitros?: { nombre: string }[]): Promise<LigaEntity> {
    return prisma.liga.create({
      data: {
        ...(data as any),
        canchas: canchas ? { create: canchas } : undefined,
        arbitros: arbitros ? { create: arbitros } : undefined,
      },
      include: BASE_INCLUDE,
    });
  },

  async update(id: string, data: Record<string, unknown>, canchas?: { nombre: string }[], arbitros?: { nombre: string }[]): Promise<LigaEntity> {
    if (canchas) {
      await prisma.ligaCancha.deleteMany({ where: { ligaId: id } });
      await prisma.ligaCancha.createMany({ data: canchas.map((c) => ({ ...c, ligaId: id })) });
    }
    if (arbitros) {
      await prisma.ligaArbitro.deleteMany({ where: { ligaId: id } });
      await prisma.ligaArbitro.createMany({ data: arbitros.map((a) => ({ ...a, ligaId: id })) });
    }
    return prisma.liga.update({
      where: { id },
      data: data as any,
      include: BASE_INCLUDE,
    });
  },

  async delete(id: string): Promise<void> {
    await prisma.liga.delete({ where: { id } });
  },
};

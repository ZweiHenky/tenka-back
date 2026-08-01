"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaRepository = void 0;
const database_1 = require("../../config/database");
const UBICACION_SELECT = {
    select: { id: true, nombreCompleto: true, estado: true, municipio: true, lat: true, lng: true },
};
const CACHAS_SELECT = {
    select: { id: true, nombre: true, activa: true, createdAt: true, updatedAt: true, ligaId: true },
};
const ARBITROS_SELECT = {
    select: { id: true, nombre: true, activo: true, createdAt: true, updatedAt: true, ligaId: true },
};
const PUBLIC_DIVISION_WHERE = { estadoLiga: { nombre: { not: 'Borrador' } } };
const DIVISION_RELATIONS = {
    categoria: { select: { id: true, nombre: true } },
    tipo: { select: { id: true, nombre: true } },
    estadoLiga: { select: { id: true, nombre: true } },
    tipoCompetencia: { select: { id: true, nombre: true } },
};
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
};
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
};
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
};
exports.ligaRepository = {
    async findAll() {
        return database_1.prisma.liga.findMany({
            where: { divisiones: { some: { estadoLiga: { nombre: { not: "Borrador" } } } } },
            orderBy: { createdAt: 'desc' },
            include: DIVISIONES_INCLUDE_PUBLIC,
        });
    },
    async findById(id) {
        return database_1.prisma.liga.findUnique({
            where: { id },
            include: DIVISIONES_INCLUDE,
        });
    },
    async findVisibleById(id, actor) {
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
        const liga = await database_1.prisma.liga.findFirst({
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
        if (liga && actor && liga.userId === actor.id)
            delete liga.user;
        return liga;
    },
    async findPublicById(id) {
        return database_1.prisma.liga.findFirst({
            where: { id, divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
            include: DIVISIONES_INCLUDE_PUBLIC,
        });
    },
    async findUpdateContext(id, actor) {
        return database_1.prisma.liga.findFirst({
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
    async findDeleteContext(id, actor) {
        return database_1.prisma.liga.findFirst({
            where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
            select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
        });
    },
    async findManagementContext(id, actor) {
        return database_1.prisma.liga.findFirst({
            where: actor.rol === 'ADMINISTRADOR' ? { id } : { id, userId: actor.id },
            select: { multiplesCanchas: true, usaArbitros: true },
        });
    },
    async findManageableCanchas(ligaId, actor) {
        const liga = await database_1.prisma.liga.findFirst({
            where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
            select: { canchas: CACHAS_SELECT },
        });
        return liga?.canchas ?? null;
    },
    async findManageableArbitros(ligaId, actor) {
        const liga = await database_1.prisma.liga.findFirst({
            where: actor.rol === 'ADMINISTRADOR' ? { id: ligaId } : { id: ligaId, userId: actor.id },
            select: { arbitros: ARBITROS_SELECT },
        });
        return liga?.arbitros ?? null;
    },
    async findRecentSchedule(ligaId, actor) {
        const liga = await database_1.prisma.liga.findFirst({
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
        if (!liga)
            return null;
        return liga;
    },
    async findByNormalizedName(nombreNormalizado, excludeId) {
        return database_1.prisma.liga.findFirst({
            where: { nombreNormalizado, id: excludeId ? { not: excludeId } : undefined },
            select: { id: true },
        });
    },
    async findByUser(userId) {
        return database_1.prisma.liga.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: DIVISIONES_INCLUDE });
    },
    async findPublicByUser(userId) {
        return database_1.prisma.liga.findMany({
            where: { userId, divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
            orderBy: { createdAt: 'desc' },
            include: DIVISIONES_INCLUDE_PUBLIC,
        });
    },
    async findAllPaginated({ page, limit, search, categoriaId, tipoId, estadoLigaId }) {
        const divisionFilters = [];
        if (categoriaId)
            divisionFilters.push({ categoriaId });
        if (tipoId)
            divisionFilters.push({ tipoId });
        if (estadoLigaId)
            divisionFilters.push({ estadoLigaId });
        const borradorFilter = { estadoLiga: { nombre: { not: "Borrador" } } };
        if (divisionFilters.length > 0) {
            divisionFilters.push(borradorFilter);
        }
        const where = {};
        if (search)
            where.nombre = { contains: search, mode: 'insensitive' };
        if (divisionFilters.length > 0) {
            where.divisiones = { some: { AND: divisionFilters } };
        }
        else {
            where.divisiones = { some: borradorFilter };
        }
        const [rows, total] = await Promise.all([
            database_1.prisma.liga.findMany({
                where: where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: DIVISIONES_INCLUDE_PUBLIC,
            }),
            database_1.prisma.liga.count({ where: where }),
        ]);
        return { rows, total };
    },
    async create(data, canchas, arbitros) {
        return database_1.prisma.liga.create({
            data: {
                ...data,
                canchas: canchas ? { create: canchas } : undefined,
                arbitros: arbitros ? { create: arbitros } : undefined,
            },
            include: BASE_INCLUDE,
        });
    },
    async update(id, data, canchas, arbitros) {
        if (canchas) {
            await database_1.prisma.ligaCancha.deleteMany({ where: { ligaId: id } });
            await database_1.prisma.ligaCancha.createMany({ data: canchas.map((c) => ({ ...c, ligaId: id })) });
        }
        if (arbitros) {
            await database_1.prisma.ligaArbitro.deleteMany({ where: { ligaId: id } });
            await database_1.prisma.ligaArbitro.createMany({ data: arbitros.map((a) => ({ ...a, ligaId: id })) });
        }
        return database_1.prisma.liga.update({
            where: { id },
            data: data,
            include: BASE_INCLUDE,
        });
    },
    async delete(id) {
        await database_1.prisma.liga.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map
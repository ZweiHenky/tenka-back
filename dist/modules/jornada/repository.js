"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jornadaRepository = void 0;
const database_1 = require("../../config/database");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
const exposeArbitros = (jornada) => ({ ...jornada, partidos: jornada.partidos?.map((partido) => ({ ...partido, arbitros: partido.arbitros?.map((row) => row.arbitro) })) });
const partidosInclude = {
    orderBy: { fecha: 'asc' },
    include: {
        equipoLocal: { select: { id: true, nombre: true, logo: true } },
        equipoVisitante: { select: { id: true, nombre: true, logo: true } },
        cancha: { select: { id: true, nombre: true } },
        arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
    },
};
exports.jornadaRepository = {
    async findAll() {
        return database_1.prisma.jornada.findMany();
    },
    async findById(id) {
        const jornada = await database_1.prisma.jornada.findUnique({
            where: { id },
            include: { partidos: partidosInclude },
        });
        return jornada ? exposeArbitros(jornada) : null;
    },
    async findVisibleById(id, actor) {
        const jornada = await database_1.prisma.jornada.findFirst({
            where: { id, division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            include: { partidos: partidosInclude },
        });
        return jornada ? exposeArbitros(jornada) : null;
    },
    async findByDivision(divisionId, options) {
        const [rows, total] = await Promise.all([
            database_1.prisma.jornada.findMany({
                where: { divisionId },
                orderBy: { numero: 'desc' },
                skip: options?.skip,
                take: options?.take,
                include: { partidos: partidosInclude },
            }),
            database_1.prisma.jornada.count({ where: { divisionId } }),
        ]);
        return { rows: rows.map(exposeArbitros), total };
    },
    async findGenerationHistory(divisionId) {
        return database_1.prisma.jornada.findMany({
            where: { divisionId },
            orderBy: { numero: 'desc' },
            select: {
                id: true,
                numero: true,
                fechaInicio: true,
                partidos: {
                    select: {
                        equipoLocalId: true,
                        equipoVisitanteId: true,
                        tipoPartido: true,
                        fecha: true,
                    },
                },
            },
        });
    },
    async findVisibleByDivision(divisionId, options, actor) {
        const division = await database_1.prisma.division.findFirst({
            where: { id: divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
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
        if (!division)
            return null;
        return { rows: division.jornadas.map(exposeArbitros), total: division._count.jornadas };
    },
    async findUpdateContext(id, actor) {
        return database_1.prisma.jornada.findFirst({
            where: actor.rol === 'ADMINISTRADOR'
                ? { id }
                : { id, division: { liga: { userId: actor.id } } },
            select: { id: true },
        });
    },
    async findDeleteContext(id, actor) {
        const jornada = await database_1.prisma.jornada.findFirst({
            where: actor.rol === 'ADMINISTRADOR'
                ? { id }
                : { id, division: { liga: { userId: actor.id } } },
            select: {
                divisionId: true,
                division: {
                    select: {
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
        if (!jornada)
            return null;
        return {
            divisionId: jornada.divisionId,
            latestJornadaId: jornada.division.jornadas[0]?.id ?? null,
            hasFinalizados: jornada.partidos.some((partido) => partido.estado === 'FINALIZADO'),
            playoffPartidos: jornada.partidos
                .filter((partido) => (partido.rondaPlayoffId !== null && partido.llave !== null))
                .map(({ id: partidoId, rondaPlayoffId, llave }) => ({ id: partidoId, rondaPlayoffId, llave })),
        };
    },
    async create(data) {
        return database_1.prisma.jornada.create({ data: data });
    },
    async update(id, data) {
        return database_1.prisma.jornada.update({ where: { id }, data });
    },
    async delete(id) {
        await database_1.prisma.jornada.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map
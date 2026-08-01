"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    ligaFindFirst: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        liga: { findFirst: mocks.ligaFindFirst },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.describe)('consultas de lectura de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)('filtra ligas y divisiones publicadas para anonimos en una operacion Prisma', async () => {
        mocks.ligaFindFirst.mockResolvedValue(null);
        await repository_1.ligaRepository.findVisibleById('liga-1');
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: {
                id: 'liga-1',
                divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } },
            },
            include: vitest_1.expect.objectContaining({
                divisiones: vitest_1.expect.objectContaining({
                    where: { estadoLiga: { nombre: { not: 'Borrador' } } },
                }),
            }),
        }));
    });
    (0, vitest_1.it)('permite al propietario ver borradores y exige publicacion al resto en la misma consulta', async () => {
        mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: owner.id, user: { name: 'Owner' } });
        const result = await repository_1.ligaRepository.findVisibleById('liga-1', owner);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        const query = mocks.ligaFindFirst.mock.calls[0][0];
        (0, vitest_1.expect)(query.where).toEqual({
            id: 'liga-1',
            OR: [
                { userId: owner.id },
                { divisiones: { some: { estadoLiga: { nombre: { not: 'Borrador' } } } } },
            ],
        });
        (0, vitest_1.expect)(query.include.divisiones.where).toEqual({
            OR: [
                { estadoLiga: { nombre: { not: 'Borrador' } } },
                { liga: { userId: owner.id } },
            ],
        });
        (0, vitest_1.expect)(result).not.toHaveProperty('user');
    });
    (0, vitest_1.it)('no aplica filtros de publicacion al administrador', async () => {
        mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1', userId: 'owner-1' });
        await repository_1.ligaRepository.findVisibleById('liga-1', admin);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst.mock.calls[0][0]).toMatchObject({
            where: { id: 'liga-1' },
            include: { user: false, divisiones: { where: undefined } },
        });
    });
    vitest_1.it.each([
        ['propietario', owner, { id: 'liga-1', userId: owner.id }],
        ['administrador', admin, { id: 'liga-1' }],
    ])('selecciona solo canchas y autorizacion para %s en una operacion Prisma', async (_label, actor, where) => {
        mocks.ligaFindFirst.mockResolvedValue({ canchas: [] });
        await (0, vitest_1.expect)(repository_1.ligaRepository.findManageableCanchas('liga-1', actor)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({
            where,
            select: {
                canchas: {
                    select: { id: true, nombre: true, activa: true, createdAt: true, updatedAt: true, ligaId: true },
                },
            },
        });
    });
    (0, vitest_1.it)('distingue una liga oculta de una liga existente sin canchas', async () => {
        mocks.ligaFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ canchas: [] });
        await (0, vitest_1.expect)(repository_1.ligaRepository.findManageableCanchas('liga-1', owner)).resolves.toBeNull();
        await (0, vitest_1.expect)(repository_1.ligaRepository.findManageableCanchas('liga-1', owner)).resolves.toEqual([]);
    });
    vitest_1.it.each([
        ['actualizacion', 'findUpdateContext', {
                logo: true,
                logoPublicId: true,
                cancha: true,
                canchaPublicId: true,
                multiplesCanchas: true,
                usaArbitros: true,
                canchas: { where: { activa: true }, select: { nombre: true } },
                arbitros: { where: { activo: true }, select: { nombre: true } },
            }],
        ['eliminacion', 'findDeleteContext', {
                logo: true, logoPublicId: true, cancha: true, canchaPublicId: true,
            }],
        ['configuracion', 'findManagementContext', {
                multiplesCanchas: true, usaArbitros: true,
            }],
    ])('selecciona solo el contexto de %s', async (_label, method, select) => {
        mocks.ligaFindFirst.mockResolvedValue({});
        await repository_1.ligaRepository[method]('liga-1', owner);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({
            where: { id: 'liga-1', userId: owner.id },
            select,
        });
    });
    (0, vitest_1.it)('selecciona solo arbitros y autorizacion al listar', async () => {
        mocks.ligaFindFirst.mockResolvedValue({ arbitros: [] });
        await (0, vitest_1.expect)(repository_1.ligaRepository.findManageableArbitros('liga-1', admin)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({
            where: { id: 'liga-1' },
            select: {
                arbitros: {
                    select: { id: true, nombre: true, activo: true, createdAt: true, updatedAt: true, ligaId: true },
                },
            },
        });
    });
    (0, vitest_1.it)('obtiene todas las divisiones con categoria y solo su ultima jornada en una operacion Prisma', async () => {
        mocks.ligaFindFirst.mockResolvedValue({
            id: 'liga-1',
            nombre: 'Liga Centro',
            divisiones: [
                {
                    id: 'division-1',
                    nombre: 'Primera',
                    categoria: { id: 'categoria-1', nombre: 'Libre' },
                    jornadas: [{
                            id: 'jornada-2',
                            numero: 2,
                            fechaInicio: null,
                            fechaFin: null,
                            partidos: [{
                                    id: 'partido-1',
                                    fecha: new Date('2026-07-31T20:00:00.000Z'),
                                    fechaFin: null,
                                    equipoLocal: { id: 'equipo-1', nombre: 'Local', logo: null },
                                    equipoVisitante: { id: 'equipo-2', nombre: 'Visitante', logo: 'logo.png' },
                                    cancha: { id: 'cancha-1', nombre: 'Central' },
                                }],
                        }],
                },
                {
                    id: 'division-2',
                    nombre: 'Segunda',
                    categoria: { id: 'categoria-2', nombre: 'Femenil' },
                    jornadas: [],
                },
            ],
        });
        const result = await repository_1.ligaRepository.findRecentSchedule('liga-1', owner);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        const query = mocks.ligaFindFirst.mock.calls[0][0];
        (0, vitest_1.expect)(query.where).toEqual({ id: 'liga-1', userId: owner.id });
        (0, vitest_1.expect)(query.select.divisiones).toMatchObject({
            orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
            select: {
                categoria: { select: { id: true, nombre: true } },
                jornadas: {
                    orderBy: [{ numero: 'desc' }, { id: 'asc' }],
                    take: 1,
                    select: {
                        partidos: {
                            orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
                        },
                    },
                },
            },
        });
        (0, vitest_1.expect)(query.select.divisiones.select.jornadas.select.partidos.select).not.toHaveProperty('arbitros');
        (0, vitest_1.expect)(result?.divisiones[0].categoria).toEqual({ id: 'categoria-1', nombre: 'Libre' });
        (0, vitest_1.expect)(result?.divisiones[0].jornadas[0].partidos[0]).not.toHaveProperty('arbitros');
        (0, vitest_1.expect)(result?.divisiones[1].jornadas).toEqual([]);
    });
    (0, vitest_1.it)('autoriza al administrador sin restringir por propietario al consultar la programacion', async () => {
        mocks.ligaFindFirst.mockResolvedValue(null);
        await repository_1.ligaRepository.findRecentSchedule('liga-1', admin);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: { id: 'liga-1' } }));
    });
    (0, vitest_1.it)('selecciona solo id al buscar nombres duplicados', async () => {
        mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-2' });
        await repository_1.ligaRepository.findByNormalizedName('liga centro', 'liga-1');
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({
            where: { nombreNormalizado: 'liga centro', id: { not: 'liga-1' } },
            select: { id: true },
        });
    });
});
//# sourceMappingURL=repository.test.js.map
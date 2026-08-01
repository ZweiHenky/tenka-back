"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const service_1 = require("./service");
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: vitest_1.vi.fn(),
        divisionEquipo: { count: vitest_1.vi.fn() },
        partido: { findFirst: vitest_1.vi.fn(), findMany: vitest_1.vi.fn(), update: vitest_1.vi.fn() },
        jornada: { findUnique: vitest_1.vi.fn(), findMany: vitest_1.vi.fn() },
    },
}));
vitest_1.vi.mock('./repository', () => ({
    partidoRepository: {
        findAuthorizationContext: vitest_1.vi.fn(),
        findAllVisible: vitest_1.vi.fn(),
        findById: vitest_1.vi.fn(),
        findVisibleById: vitest_1.vi.fn(),
        findVisibleByJornada: vitest_1.vi.fn(),
        findVisibleByRondaPlayoff: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../tabla-posicion/service', () => ({
    tablaPosicionService: { recalcular: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../ronda-playoff/service', () => ({
    rondaPlayoffService: { advanceWinners: vitest_1.vi.fn() },
}));
const database_1 = require("../../config/database");
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const other = { id: 'other-user', email: 'other@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const context = {
    id: 'partido-1',
    ligaUserId: 'owner-1',
    estado: 'PROGRAMADO',
    golesLocal: 0,
    golesVisitante: 0,
    penalesLocal: null,
    penalesVisitante: null,
    jornadaId: 'jornada-1',
    rondaPlayoffId: null,
    divisionId: 'division-1',
    tipoPartido: 'REGULAR',
    equipoLocalId: 'equipo-1',
    equipoVisitanteId: 'equipo-2',
    fecha: new Date('2026-08-01T18:00:00Z'),
    fechaFin: new Date('2026-08-01T19:00:00Z'),
};
const partido = {
    ...context,
    golesLocal: 0,
    golesVisitante: 0,
    penalesLocal: null,
    penalesVisitante: null,
};
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    vitest_1.vi.mocked(repository_1.partidoRepository.findAuthorizationContext).mockResolvedValue(context);
    vitest_1.vi.mocked(repository_1.partidoRepository.findAllVisible).mockResolvedValue([partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.findById).mockResolvedValue(partido);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleById).mockResolvedValue(partido);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleByJornada).mockResolvedValue([partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleByRondaPlayoff).mockResolvedValue([partido]);
    vitest_1.vi.mocked(repository_1.partidoRepository.update).mockResolvedValue(partido);
    vitest_1.vi.mocked(database_1.prisma.divisionEquipo.count).mockResolvedValue(1);
    vitest_1.vi.mocked(database_1.prisma.partido.findFirst).mockResolvedValue(null);
    vitest_1.vi.mocked(database_1.prisma.$transaction).mockImplementation(async (callback) => callback(database_1.prisma));
    vitest_1.vi.mocked(database_1.prisma.jornada.findUnique).mockResolvedValue({ numero: 1, divisionId: 'division-1' });
    vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                { id: 'partido-1', estado: 'PROGRAMADO', fecha: context.fecha, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
            ] }]);
    vitest_1.vi.mocked(database_1.prisma.partido.update).mockImplementation((async ({ where, data }) => ({ ...partido, id: where.id, ...data, arbitros: [] })));
    vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([{
            id: 'partido-2',
            estado: 'PROGRAMADO',
            fecha: new Date('2026-08-01T20:00:00Z'),
            fechaFin: new Date('2026-08-01T21:00:00Z'),
            equipoLocalId: 'equipo-3',
            equipoVisitanteId: 'equipo-4',
        }]);
});
(0, vitest_1.describe)('partidoService public collections', () => {
    (0, vitest_1.it)('delegates the visible list to one repository operation with the actor', async () => {
        await (0, vitest_1.expect)(service_1.partidoService.list(owner)).resolves.toEqual([partido]);
        (0, vitest_1.expect)(repository_1.partidoRepository.findAllVisible).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.partidoRepository.findAllVisible).toHaveBeenCalledWith(owner);
        (0, vitest_1.expect)(database_1.prisma.partido.findMany).not.toHaveBeenCalled();
    });
    vitest_1.it.each([
        ['jornada', () => service_1.partidoService.findByJornada('parent-1'), repository_1.partidoRepository.findVisibleByJornada, 'Jornada'],
        ['ronda playoff', () => service_1.partidoService.findByRondaPlayoff('parent-1'), repository_1.partidoRepository.findVisibleByRondaPlayoff, 'Ronda playoff'],
    ])('returns an empty collection for a visible empty %s and 404 for a hidden or missing parent', async (_label, invoke, repositoryMethod, resource) => {
        vitest_1.vi.mocked(repositoryMethod).mockResolvedValueOnce([]).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(invoke()).resolves.toEqual([]);
        await (0, vitest_1.expect)(invoke()).rejects.toMatchObject({ statusCode: 404, message: `${resource} no encontrado` });
        (0, vitest_1.expect)(repositoryMethod).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('passes the optional-auth actor to both parent visibility queries', async () => {
        await service_1.partidoService.findByJornada('jornada-1', owner);
        await service_1.partidoService.findByRondaPlayoff('ronda-1', admin);
        (0, vitest_1.expect)(repository_1.partidoRepository.findVisibleByJornada).toHaveBeenCalledWith('jornada-1', owner);
        (0, vitest_1.expect)(repository_1.partidoRepository.findVisibleByRondaPlayoff).toHaveBeenCalledWith('ronda-1', admin);
    });
});
(0, vitest_1.describe)('partidoService.getById', () => {
    (0, vitest_1.it)('loads the visible detail in a single repository call', async () => {
        await (0, vitest_1.expect)(service_1.partidoService.getById('partido-1', owner)).resolves.toEqual(partido);
        (0, vitest_1.expect)(repository_1.partidoRepository.findVisibleById).toHaveBeenCalledWith('partido-1', owner);
        (0, vitest_1.expect)(repository_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(repository_1.partidoRepository.findAuthorizationContext).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('hides missing or unauthorized matches as 404', async () => {
        vitest_1.vi.mocked(repository_1.partidoRepository.findVisibleById).mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.partidoService.getById('partido-hidden', other)).rejects.toMatchObject({ statusCode: 404 });
    });
});
(0, vitest_1.describe)('partidoService.update team replacement', () => {
    (0, vitest_1.it)('does not apply replacement checks to score/result updates', async () => {
        await service_1.partidoService.update('partido-1', { golesLocal: 2 }, owner);
        (0, vitest_1.expect)(database_1.prisma.divisionEquipo.count).not.toHaveBeenCalled();
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).not.toHaveBeenCalled();
        (0, vitest_1.expect)(repository_1.partidoRepository.update).toHaveBeenCalledWith('partido-1', { golesLocal: 2 });
    });
    (0, vitest_1.it)('swaps teams while preserving each selected side', async () => {
        await service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);
        (0, vitest_1.expect)(database_1.prisma.divisionEquipo.count).toHaveBeenCalledWith({
            where: { divisionId: 'division-1', equipoId: 'equipo-3' },
        });
        (0, vitest_1.expect)(database_1.prisma.partido.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({
                id: { not: 'partido-1' },
                jornadaId: 'jornada-1',
                tipoPartido: 'REGULAR',
            }),
        }));
        (0, vitest_1.expect)(database_1.prisma.partido.update).toHaveBeenCalledWith({
            where: { id: 'partido-2' }, data: { equipoLocalId: 'equipo-1' },
        });
        (0, vitest_1.expect)(database_1.prisma.partido.update).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: 'partido-1' }, data: { equipoLocalId: 'equipo-3' },
        }));
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: { notIn: ['partido-1', 'partido-2'] } }),
        }));
    });
    (0, vitest_1.it)('blocks when the incoming team has no match in the jornada', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('no tiene otro partido en esta jornada');
    });
    (0, vitest_1.it)('blocks an ambiguous incoming team appearance', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([{ id: 'p2' }, { id: 'p3' }]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('intercambio es ambiguo');
    });
    (0, vitest_1.it)('blocks a target match that is not PROGRAMADO', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([{
                id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4',
            }]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('partido del equipo seleccionado debe estar programado');
    });
    (0, vitest_1.it)('rejects replacement unless the match is PROGRAMADO', async () => {
        vitest_1.vi.mocked(repository_1.partidoRepository.findAuthorizationContext).mockResolvedValue({ ...context, estado: null });
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('Solo se pueden reemplazar equipos en partidos programados');
    });
    (0, vitest_1.it)('rejects playoff matches', async () => {
        vitest_1.vi.mocked(repository_1.partidoRepository.findAuthorizationContext).mockResolvedValue({
            ...context,
            jornadaId: null,
            rondaPlayoffId: 'ronda-1',
        });
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('Solo se pueden reemplazar equipos en partidos regulares de jornada');
    });
    (0, vitest_1.it)('rejects a team outside the jornada division', async () => {
        vitest_1.vi.mocked(database_1.prisma.divisionEquipo.count).mockResolvedValue(0);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('El equipo de reemplazo no pertenece a la división de la jornada');
    });
    (0, vitest_1.it)('rejects making local and visitor the same team', async () => {
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-2' }, owner))
            .rejects.toThrow('El equipo local y visitante deben ser diferentes');
    });
    (0, vitest_1.it)('rejects when the outgoing team would face itself in the target match', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([{
                id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-1',
                fecha: new Date('2026-08-01T20:00:00Z'), fechaFin: new Date('2026-08-01T21:00:00Z'),
            }]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('mismo equipo como local y visitante');
    });
    (0, vitest_1.it)('rejects an overlapping match in the same division', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' });
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoVisitanteId: 'equipo-3' }, owner))
            .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({
                id: { notIn: ['partido-1', 'partido-2'] },
                AND: vitest_1.expect.arrayContaining([{ OR: [
                            { jornada: { divisionId: 'division-1' } },
                            { rondaPlayoff: { divisionId: 'division-1' } },
                        ] }]),
            }),
        }));
    });
    (0, vitest_1.it)('checks both resulting intervals in one conflict query', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' });
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        const intervalPredicates = vitest_1.vi.mocked(database_1.prisma.partido.findFirst).mock.calls[0][0].where.AND[1].OR;
        (0, vitest_1.expect)(intervalPredicates).toEqual([
            {
                fecha: { lt: context.fechaFin },
                fechaFin: { gt: context.fecha },
                OR: [{ equipoLocalId: 'equipo-3' }, { equipoVisitanteId: 'equipo-3' }],
            },
            {
                fecha: { lt: new Date('2026-08-01T21:00:00Z') },
                fechaFin: { gt: new Date('2026-08-01T20:00:00Z') },
                OR: [{ equipoLocalId: 'equipo-1' }, { equipoVisitanteId: 'equipo-1' }],
            },
        ]);
        (0, vitest_1.expect)(database_1.prisma.$transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('keeps owner authorization before replacement validation', async () => {
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, other))
            .rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(database_1.prisma.divisionEquipo.count).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows an administrator to update a foreign partido', async () => {
        await service_1.partidoService.update('partido-1', { golesLocal: 2 }, admin);
        (0, vitest_1.expect)(repository_1.partidoRepository.update).toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('partidoService private query budgets', () => {
    (0, vitest_1.it)('updates a score with only the authorization-context read and update write', async () => {
        const updated = { ...partido, golesLocal: 2 };
        vitest_1.vi.mocked(repository_1.partidoRepository.update).mockResolvedValue(updated);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { golesLocal: 2 }, owner)).resolves.toEqual(updated);
        (0, vitest_1.expect)(repository_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.partidoRepository.update).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(repository_1.partidoRepository.findVisibleById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('deletes with only the authorization-context read and delete write', async () => {
        await service_1.partidoService.delete('partido-1', owner);
        (0, vitest_1.expect)(repository_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.partidoRepository.delete).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.partidoRepository.delete).toHaveBeenCalledWith('partido-1');
        (0, vitest_1.expect)(repository_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(repository_1.partidoRepository.findVisibleById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('uses one conflict read and one transactional schedule snapshot for a replacement', async () => {
        await service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);
        (0, vitest_1.expect)(repository_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.divisionEquipo.count).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.jornada.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.jornada.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { divisionId: 'division-1' },
        }));
        (0, vitest_1.expect)(database_1.prisma.jornada.findUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(database_1.prisma.partido.update).toHaveBeenCalledTimes(2);
    });
});
(0, vitest_1.describe)('findDeterministicMatching', () => {
    (0, vitest_1.it)('finds the first sorted perfect matching without repeated pairs', () => {
        (0, vitest_1.expect)((0, service_1.findDeterministicMatching)(['d', 'b', 'a', 'c'], new Set(['a|b', 'a|c']))).toEqual([
            ['a', 'd'], ['b', 'c'],
        ]);
    });
    (0, vitest_1.it)('returns null for malformed or impossible participant sets', () => {
        (0, vitest_1.expect)((0, service_1.findDeterministicMatching)(['a', 'a'], new Set())).toBeNull();
        (0, vitest_1.expect)((0, service_1.findDeterministicMatching)(['a', 'b'], new Set(['a|b']))).toBeNull();
    });
});
(0, vitest_1.describe)('partidoService future jornada recalculation', () => {
    (0, vitest_1.it)('preserves future partido ids and reports recalculated jornadas', async () => {
        vitest_1.vi.mocked(database_1.prisma.jornada.findMany)
            .mockReset()
            .mockResolvedValue([
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', fecha: context.fecha, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [
                    { id: 'future-b', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T20:00:00Z'), equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
                    { id: 'future-a', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T18:00:00Z'), equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
                ] },
        ]);
        const result = await service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);
        (0, vitest_1.expect)(result.jornadasRecalculadas).toBe(1);
        (0, vitest_1.expect)(database_1.prisma.partido.update).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: { id: 'future-a' } }));
        (0, vitest_1.expect)(database_1.prisma.partido.update).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: { id: 'future-b' } }));
    });
    (0, vitest_1.it)('blocks a future regular match that is not programmed before writes', async () => {
        vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockReset().mockResolvedValueOnce([
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' }] },
        ]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('jornadas posteriores deben estar programados');
        (0, vitest_1.expect)(database_1.prisma.partido.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('blocks when a future participant set has no unused perfect matching', async () => {
        vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockReset()
            .mockResolvedValue([
            { id: 'jornada-0', numero: 0, partidos: [
                    { id: 'history', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
                ] },
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' }] },
        ]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('No existe una combinación válida');
        (0, vitest_1.expect)(database_1.prisma.partido.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('aborts without writes when the target changes after the preflight read', async () => {
        vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockResolvedValue([{
                id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ],
            }]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('Los partidos del intercambio deben continuar programados');
        (0, vitest_1.expect)(database_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not overwrite participants changed after the preflight read', async () => {
        vitest_1.vi.mocked(database_1.prisma.jornada.findMany).mockResolvedValue([{
                id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' },
                ],
            }]);
        await (0, vitest_1.expect)(service_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
            .rejects.toThrow('Los participantes de los partidos del intercambio cambiaron');
        (0, vitest_1.expect)(database_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.update).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map
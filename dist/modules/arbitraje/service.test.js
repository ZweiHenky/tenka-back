"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db = vitest_1.vi.hoisted(() => ({
    ligaFindUnique: vitest_1.vi.fn(),
    tandaFindFirst: vitest_1.vi.fn(),
    tandaCreate: vitest_1.vi.fn(),
    tandaDelete: vitest_1.vi.fn(),
    linksFindMany: vitest_1.vi.fn(),
    linksCreateMany: vitest_1.vi.fn(),
    divisionFindMany: vitest_1.vi.fn(),
    refereeFindMany: vitest_1.vi.fn(),
    assignmentsFindMany: vitest_1.vi.fn(),
    assignmentsDeleteMany: vitest_1.vi.fn(),
    assignmentsCreateMany: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        liga: { findUnique: db.ligaFindUnique },
        tandaArbitral: { findFirst: db.tandaFindFirst, delete: db.tandaDelete },
        tandaArbitralPartido: { findMany: db.linksFindMany },
        division: { findMany: db.divisionFindMany },
        ligaArbitro: { findMany: db.refereeFindMany },
        partidoArbitro: { findMany: db.assignmentsFindMany, deleteMany: db.assignmentsDeleteMany },
        $transaction: db.transaction,
    },
}));
const service_1 = require("./service");
const validator_1 = require("./validator");
const at = (hour, minute = 0) => new Date(2026, 6, 26, hour, minute);
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    db.transaction.mockImplementation(async (callback) => callback({
        tandaArbitral: { create: db.tandaCreate },
        tandaArbitralPartido: { findMany: db.linksFindMany, createMany: db.linksCreateMany },
        partidoArbitro: { deleteMany: db.assignmentsDeleteMany, createMany: db.assignmentsCreateMany },
    }));
});
(0, vitest_1.describe)('direct league assignments', () => {
    const divisions = [
        { id: 'd1', partidos: [{ id: 'm1', fecha: at(9), fechaFin: at(10) }, { id: 'm2', fecha: at(10), fechaFin: at(11) }] },
    ];
    (0, vitest_1.it)('saves direct assignments and creates their history record in one transaction', async () => {
        db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
        db.divisionFindMany.mockResolvedValue([{ id: 'd1', jornadas: [{ partidos: divisions[0].partidos }], rondasPlayoff: [] }]);
        db.refereeFindMany.mockResolvedValue([{ id: 'a', nombre: 'Ana' }]);
        db.assignmentsFindMany.mockResolvedValue([]);
        db.linksFindMany.mockResolvedValue([]);
        db.tandaCreate.mockResolvedValue({ id: 'batch-1' });
        const result = await service_1.arbitrajeService.replaceLeagueAssignments('league-1', owner, {
            divisionIds: ['d1'], asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }],
        });
        (0, vitest_1.expect)(db.linksCreateMany).toHaveBeenCalledWith({ data: [{ tandaId: 'batch-1', partidoId: 'm1' }] });
        (0, vitest_1.expect)(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1'] } } });
        (0, vitest_1.expect)(db.assignmentsCreateMany).toHaveBeenCalledWith({ data: [{ partidoId: 'm1', arbitroId: 'a' }] });
        (0, vitest_1.expect)(result).toMatchObject({ asignacionId: 'batch-1', partidosAsignados: 1, asignacionesCreadas: 1 });
    });
    (0, vitest_1.it)('deletes assignment referee rows and history in one transaction', async () => {
        db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
        db.tandaFindFirst.mockResolvedValue({ id: 'batch-1', ligaId: 'league-1', liga: { userId: 'user-1' } });
        db.linksFindMany.mockResolvedValue([{ partidoId: 'm1' }, { partidoId: 'm2' }]);
        const removeRows = { operation: 'remove-rows' };
        const removeHistory = { operation: 'remove-history' };
        db.assignmentsDeleteMany.mockReturnValue(removeRows);
        db.tandaDelete.mockReturnValue(removeHistory);
        db.transaction.mockResolvedValue([]);
        await service_1.arbitrajeService.removeAssignment('league-1', 'batch-1', owner);
        (0, vitest_1.expect)(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1', 'm2'] } } });
        (0, vitest_1.expect)(db.tandaDelete).toHaveBeenCalledWith({ where: { id: 'batch-1' } });
        (0, vitest_1.expect)(db.transaction).toHaveBeenCalledWith([removeRows, removeHistory]);
    });
    (0, vitest_1.it)('allows an administrator to manage a foreign league', async () => {
        db.ligaFindUnique.mockResolvedValue({ userId: 'user-1' });
        db.divisionFindMany.mockResolvedValue([]);
        db.refereeFindMany.mockResolvedValue([]);
        db.assignmentsFindMany.mockResolvedValue([]);
        db.linksFindMany.mockResolvedValue([]);
        db.tandaCreate.mockResolvedValue({ id: 'batch-1' });
        await (0, vitest_1.expect)(service_1.arbitrajeService.replaceLeagueAssignments('league-1', admin, {
            divisionIds: [], asignaciones: [],
        })).resolves.toMatchObject({ asignacionId: 'batch-1' });
    });
    (0, vitest_1.it)('checks ownership and batch membership once when editing', async () => {
        db.tandaFindFirst.mockResolvedValue({ id: 'batch-1', ligaId: 'league-1', liga: { userId: 'user-1' } });
        db.linksFindMany.mockResolvedValue([{ partidoId: 'm1' }]);
        db.divisionFindMany.mockResolvedValue([{ id: 'd1', jornadas: [{ partidos: divisions[0].partidos }], rondasPlayoff: [] }]);
        db.refereeFindMany.mockResolvedValue([{ id: 'a', nombre: 'Ana' }]);
        db.assignmentsFindMany.mockResolvedValue([]);
        await service_1.arbitrajeService.replaceLeagueAssignments('league-1', owner, {
            asignacionId: 'batch-1', divisionIds: ['d1'], asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }],
        });
        (0, vitest_1.expect)(db.tandaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(db.ligaFindUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(db.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(db.assignmentsDeleteMany).toHaveBeenCalledWith({ where: { partidoId: { in: ['m1'] } } });
        (0, vitest_1.expect)(db.assignmentsCreateMany).toHaveBeenCalledWith({ data: [{ partidoId: 'm1', arbitroId: 'a' }] });
    });
    (0, vitest_1.it)('parses the replacement payload and allows back-to-back assignments', () => {
        (0, vitest_1.expect)((0, service_1.overlaps)(at(9), at(10), at(10), at(11))).toBe(false);
        const payload = validator_1.asignacionesLigaSchema.parse({
            divisionIds: ['d1'],
            asignaciones: [{ partidoId: 'm1', arbitroIds: ['a'] }, { partidoId: 'm2', arbitroIds: ['a', 'b'] }],
        });
        (0, vitest_1.expect)((0, service_1.planLeagueAssignments)(payload.divisionIds, payload.asignaciones, divisions, ['a', 'b'])).toEqual([
            { partidoId: 'm1', arbitroId: 'a' },
            { partidoId: 'm2', arbitroId: 'a' },
            { partidoId: 'm2', arbitroId: 'b' },
        ]);
        (0, vitest_1.expect)(validator_1.asignacionesLigaSchema.parse({ ...payload, asignacionId: 'batch-1' }).asignacionId).toBe('batch-1');
    });
    (0, vitest_1.it)('rejects duplicate ids and entities outside the selected league scope', () => {
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1', 'd1'], [], divisions, [])).toThrow('divisiones no pueden repetirse');
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: [] }, { partidoId: 'm1', arbitroIds: [] }], divisions, [])).toThrow('partidos no pueden repetirse');
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'other', arbitroIds: [] }], divisions, [])).toThrow('división seleccionada');
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: ['other'] }], divisions, ['a'])).toThrow('activos y pertenecer');
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: ['a', 'a'] }], divisions, ['a'])).toThrow('repetirse en un partido');
    });
    (0, vitest_1.it)('requires valid dates for assigned matches and rejects overlap', () => {
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }], [{ id: 'd1', partidos: [{ id: 'm1', fecha: null, fechaFin: null }] }], ['a'])).toThrow('fecha y fechaFin válidas');
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }, { partidoId: 'm2', arbitroIds: ['a'] }], [{ id: 'd1', partidos: [{ id: 'm1', fecha: at(9), fechaFin: at(11) }, { id: 'm2', fecha: at(10), fechaFin: at(12) }] }], ['a'])).toThrow('traslapados');
    });
    (0, vitest_1.it)('rejects overlap with an assignment already saved elsewhere in the league', () => {
        (0, vitest_1.expect)(() => (0, service_1.planLeagueAssignments)(['d1'], [{ partidoId: 'm1', arbitroIds: ['a'] }], divisions, ['a'], [
            { arbitroId: 'a', fecha: at(9, 30), fechaFin: at(10, 30) },
        ])).toThrow('traslapados');
    });
});
(0, vitest_1.describe)('private assignment reads', () => {
    const refereeRow = { arbitro: { id: 'a', nombre: 'Ana' } };
    const match = {
        id: 'm1', fecha: at(9), fechaFin: at(10), equipoLocal: null, equipoVisitante: null, cancha: null, arbitros: [refereeRow],
    };
    (0, vitest_1.it)('lists batches with ownership and counts in one query', async () => {
        const batches = [{ id: 'batch-1', ligaId: 'league-1', nombre: 'Asignación', _count: { partidos: 2 } }];
        db.ligaFindUnique.mockResolvedValue({ userId: 'user-1', tandasArbitrales: batches });
        await (0, vitest_1.expect)(service_1.arbitrajeService.list('league-1', owner)).resolves.toEqual(batches);
        (0, vitest_1.expect)(db.ligaFindUnique).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(db.tandaFindFirst).not.toHaveBeenCalled();
        (0, vitest_1.expect)(db.ligaFindUnique).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            select: vitest_1.expect.objectContaining({ userId: true, tandasArbitrales: vitest_1.expect.any(Object) }),
        }));
    });
    (0, vitest_1.it)('loads an owned batch detail in one query without exposing the ownership relation', async () => {
        db.tandaFindFirst.mockResolvedValue({
            id: 'batch-1', ligaId: 'league-1', nombre: 'Asignación', liga: { userId: 'user-1' },
            partidos: [{ tandaId: 'batch-1', partidoId: 'm1', partido: { ...match, jornada: null, rondaPlayoff: null } }],
        });
        const result = await service_1.arbitrajeService.detail('league-1', 'batch-1', owner);
        (0, vitest_1.expect)(db.tandaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(db.ligaFindUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(result).not.toHaveProperty('liga');
        (0, vitest_1.expect)(result.partidos[0].arbitros).toEqual([{ id: 'a', nombre: 'Ana' }]);
    });
    (0, vitest_1.it)('loads candidates in one narrow query and restores existing parent response fields', async () => {
        db.ligaFindUnique.mockResolvedValue({
            userId: 'user-1',
            divisiones: [{
                    id: 'd1', nombre: 'Primera',
                    jornadas: [{ id: 'j1', numero: 1, partidos: [match] }],
                    rondasPlayoff: [{ id: 'r1', nombre: 'Final', orden: 1, partidos: [{ ...match, id: 'm2' }] }],
                }],
        });
        const result = await service_1.arbitrajeService.candidates('league-1', owner);
        (0, vitest_1.expect)(db.ligaFindUnique).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(db.divisionFindMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(result[0].jornadas[0].partidos[0]).toMatchObject({
            jornada: { id: 'j1', numero: 1, division: { id: 'd1', nombre: 'Primera' } }, rondaPlayoff: null,
            arbitros: [{ id: 'a', nombre: 'Ana' }],
        });
        (0, vitest_1.expect)(result[0].rondasPlayoff[0].partidos[0]).toMatchObject({
            jornada: null, rondaPlayoff: { id: 'r1', nombre: 'Final', division: { id: 'd1', nombre: 'Primera' } },
        });
        const query = db.ligaFindUnique.mock.calls[0][0];
        const jornadaMatch = query.select.divisiones.select.jornadas.select.partidos;
        (0, vitest_1.expect)(jornadaMatch.include).not.toHaveProperty('jornada');
        (0, vitest_1.expect)(jornadaMatch.include).not.toHaveProperty('rondaPlayoff');
    });
});
//# sourceMappingURL=service.test.js.map
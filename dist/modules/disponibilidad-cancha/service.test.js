"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_1 = require("../../utils/errors");
const service_1 = require("./service");
const actor = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };
const inicio = new Date('2026-08-01T00:00:00.000Z');
const fin = new Date('2026-08-02T00:00:00.000Z');
const assigned = { id: 'p1', fecha: inicio, fechaFin: fin, canchaId: 'court', division: { id: 'd1', nombre: 'Primera' } };
const unassigned = { ...assigned, id: 'p2', canchaId: null };
function repository(context) {
    return {
        findLeagueContext: vitest_1.vi.fn().mockResolvedValue(context),
        findOccupancy: vitest_1.vi.fn().mockResolvedValue([assigned, unassigned]),
    };
}
(0, vitest_1.describe)('DisponibilidadCanchaService', () => {
    (0, vitest_1.it)('returns MULTIPLE assignments keyed by cancha and scheduled matches without cancha separately', async () => {
        const repo = repository({ id: 'liga', multiplesCanchas: true, canchas: [{ id: 'court', nombre: 'Central' }] });
        const result = await new service_1.DisponibilidadCanchaService(repo).get('liga', inicio, fin, actor);
        (0, vitest_1.expect)(result).toMatchObject({
            mode: 'MULTIPLE',
            canchas: [{ id: 'court', nombre: 'Central' }],
            asignaciones: { court: [assigned] },
            partidosSinCancha: [unassigned],
            ocupaciones: [assigned, unassigned],
        });
        (0, vitest_1.expect)(repo.findOccupancy).toHaveBeenCalledWith('liga', inicio, fin);
    });
    (0, vitest_1.it)('returns all matches as virtual occupancy and no courts in SINGLE mode', async () => {
        const repo = repository({ id: 'liga', multiplesCanchas: false, canchas: [{ id: 'court', nombre: 'Ignored' }] });
        const result = await new service_1.DisponibilidadCanchaService(repo).get('liga', inicio, fin, actor);
        (0, vitest_1.expect)(result.mode).toBe('SINGLE');
        (0, vitest_1.expect)(result.canchas).toEqual([]);
        (0, vitest_1.expect)(result.ocupaciones).toEqual([assigned, unassigned]);
        (0, vitest_1.expect)(result.asignaciones).toEqual({});
        (0, vitest_1.expect)(result.partidosSinCancha).toEqual([]);
    });
    (0, vitest_1.it)('returns 404 semantics without querying matches for missing or foreign leagues', async () => {
        const repo = repository(null);
        await (0, vitest_1.expect)(new service_1.DisponibilidadCanchaService(repo).get('foreign', inicio, fin, actor))
            .rejects.toEqual(new errors_1.NotFoundError('Liga'));
        (0, vitest_1.expect)(repo.findOccupancy).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map
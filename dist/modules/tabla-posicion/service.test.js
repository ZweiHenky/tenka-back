"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ findByDivision: vitest_1.vi.fn(), findOne: vitest_1.vi.fn() }));
vitest_1.vi.mock('./repository', () => ({
    tablaPosicionRepository: {
        findByDivision: mocks.findByDivision,
        findOne: mocks.findOne,
    },
}));
vitest_1.vi.mock('../../config/database', () => ({ prisma: {} }));
const service_1 = require("./service");
const team = { id: 'team-1', nombre: 'Team One', logo: null };
const row = {
    id: 'standing-1', partidosJugados: 1, ganados: 1, empatados: 0, perdidos: 0,
    golesFavor: 2, golesContra: 0, diferenciaGoles: 2, puntos: 3,
    divisionId: 'division-1', equipoId: 'team-1', equipo: team,
};
(0, vitest_1.describe)('tablaPosicionService public reads', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('returns persisted standings with one operation', async () => {
        mocks.findByDivision.mockResolvedValue({ tablaPosiciones: [row], equipos: [] });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findByDivision('division-1')).resolves.toEqual([row]);
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('preserves placeholders when a visible division has teams but no standings', async () => {
        mocks.findByDivision.mockResolvedValue({
            tablaPosiciones: [],
            equipos: [{ equipoId: 'team-1', equipo: team }],
        });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findByDivision('division-1')).resolves.toEqual([{
                id: 'placeholder-team-1', partidosJugados: 0, ganados: 0, empatados: 0,
                perdidos: 0, golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
                divisionId: 'division-1', equipoId: 'team-1', equipo: team,
            }]);
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('returns empty for a visible division without standings or teams', async () => {
        mocks.findByDivision.mockResolvedValue({ tablaPosiciones: [], equipos: [] });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findByDivision('division-1')).resolves.toEqual([]);
    });
    (0, vitest_1.it)('returns division 404 for a hidden or missing division', async () => {
        mocks.findByDivision.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findByDivision('division-1')).rejects.toMatchObject({
            statusCode: 404, message: 'División no encontrado',
        });
    });
    (0, vitest_1.it)('distinguishes a hidden division from a visible division without the requested standing', async () => {
        mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ tablaPosiciones: [] });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findOne('hidden', 'team-1')).rejects.toMatchObject({
            statusCode: 404, message: 'División no encontrado',
        });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findOne('visible', 'team-1')).rejects.toMatchObject({
            statusCode: 404, message: 'Posición no encontrado',
        });
        (0, vitest_1.expect)(mocks.findOne).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('returns one standing with one operation', async () => {
        mocks.findOne.mockResolvedValue({ tablaPosiciones: [row] });
        await (0, vitest_1.expect)(service_1.tablaPosicionService.findOne('division-1', 'team-1')).resolves.toBe(row);
        (0, vitest_1.expect)(mocks.findOne).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=service.test.js.map
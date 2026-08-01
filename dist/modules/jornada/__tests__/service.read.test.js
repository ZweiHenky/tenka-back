"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findVisibleById: vitest_1.vi.fn(),
    findVisibleByDivision: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../../config/database', () => ({ prisma: { jornada: { findMany: vitest_1.vi.fn() } } }));
vitest_1.vi.mock('../repository', () => ({
    jornadaRepository: {
        findVisibleById: mocks.findVisibleById,
        findVisibleByDivision: mocks.findVisibleByDivision,
    },
}));
vitest_1.vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vitest_1.vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vitest_1.vi.mock('../../notification/service', () => ({ notificationService: {} }));
const service_1 = require("../service");
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('jornadaService public read visibility', () => {
    (0, vitest_1.it)('returns 404 semantics for a missing or hidden jornada', async () => {
        mocks.findVisibleById.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.jornadaService.getById('hidden')).rejects.toMatchObject({ statusCode: 404 });
    });
    (0, vitest_1.it)('returns 404 semantics for a missing or hidden division', async () => {
        mocks.findVisibleByDivision.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.jornadaService.findByDivision('hidden')).rejects.toMatchObject({ statusCode: 404 });
    });
    (0, vitest_1.it)('preserves a visible empty division result', async () => {
        mocks.findVisibleByDivision.mockResolvedValue({ rows: [], total: 0 });
        await (0, vitest_1.expect)(service_1.jornadaService.findByDivision('visible')).resolves.toEqual({ rows: [], total: 0 });
    });
});
//# sourceMappingURL=service.read.test.js.map
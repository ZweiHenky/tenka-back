"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ generateNext: vitest_1.vi.fn() }));
vitest_1.vi.mock('../service', () => ({ jornadaService: { generateNext: mocks.generateNext } }));
const controller_1 = require("../controller");
function response() {
    const json = vitest_1.vi.fn();
    const status = vitest_1.vi.fn(() => ({ json }));
    return { res: { status }, status, json };
}
(0, vitest_1.describe)('jornadaController.generateNext', () => {
    (0, vitest_1.it)('requires an idempotency key', async () => {
        const req = {
            params: { divisionId: 'division-1' }, body: { equipoIds: ['a', 'b'] }, user: { id: 'owner' }, get: vitest_1.vi.fn(() => undefined),
        };
        const { res } = response();
        const next = vitest_1.vi.fn();
        await controller_1.jornadaController.generateNext(req, res, next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 422 }));
        (0, vitest_1.expect)(mocks.generateNext).not.toHaveBeenCalled();
    });
    vitest_1.it.each([
        [false, 201, 'Jornada generada exitosamente'],
        [true, 200, 'Jornada generada previamente'],
    ])('uses the replay-aware response status', async (idempotencyReplayed, expectedStatus, message) => {
        mocks.generateNext.mockResolvedValue({ id: 'jornada-1', numero: 1, idempotencyReplayed });
        const req = {
            params: { divisionId: 'division-1' }, body: { equipoIds: ['a', 'b'] }, user: { id: 'owner' }, get: vitest_1.vi.fn(() => 'generation-key-1'),
        };
        const { res, status, json } = response();
        const next = vitest_1.vi.fn();
        await controller_1.jornadaController.generateNext(req, res, next);
        (0, vitest_1.expect)(mocks.generateNext).toHaveBeenCalledWith('division-1', req.user, undefined, ['a', 'b'], undefined, 'generation-key-1');
        (0, vitest_1.expect)(status).toHaveBeenCalledWith(expectedStatus);
        (0, vitest_1.expect)(json).toHaveBeenCalledWith({ success: true, data: { id: 'jornada-1', numero: 1 }, message });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.generate.test.js.map
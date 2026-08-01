"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ findByDivision: vitest_1.vi.fn() }));
vitest_1.vi.mock('../service', () => ({ jornadaService: { findByDivision: mocks.findByDivision } }));
const controller_1 = require("../controller");
(0, vitest_1.describe)('jornadaController.findByDivision', () => {
    (0, vitest_1.it)('keeps page 1 and limit 10 as the default pagination', async () => {
        const result = { rows: [], total: 0 };
        mocks.findByDivision.mockResolvedValue(result);
        const req = { params: { divisionId: 'd-1' }, query: {}, user: undefined };
        const json = vitest_1.vi.fn();
        const status = vitest_1.vi.fn(() => ({ json }));
        const res = { status };
        const next = vitest_1.vi.fn();
        await controller_1.jornadaController.findByDivision(req, res, next);
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledWith('d-1', { skip: 0, take: 10 }, undefined);
        (0, vitest_1.expect)(status).toHaveBeenCalledWith(200);
        (0, vitest_1.expect)(json).toHaveBeenCalledWith({ success: true, data: result });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.read.test.js.map
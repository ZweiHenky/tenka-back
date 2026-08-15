"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ findByDivision: vitest_1.vi.fn(), updateSaldoPendiente: vitest_1.vi.fn() }));
vitest_1.vi.mock('./service', () => ({
    divisionEquipoService: {
        findByDivision: mocks.findByDivision,
        updateSaldoPendiente: mocks.updateSaldoPendiente,
    },
}));
const controller_1 = require("./controller");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
function request(body) {
    return {
        params: { divisionId: 'division-1', equipoId: 'equipo-1' },
        body,
        user: owner,
    };
}
function response() {
    return { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn() };
}
(0, vitest_1.describe)('divisionEquipoController.updateSaldoPendiente', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('canonicalizes the payload and returns the required message', async () => {
        mocks.updateSaldoPendiente.mockResolvedValue({
            divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '7.50',
        });
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.divisionEquipoController.updateSaldoPendiente(request({ saldoPendiente: '7.5' }), res, next);
        (0, vitest_1.expect)(mocks.updateSaldoPendiente).toHaveBeenCalledWith('division-1', 'equipo-1', '7.50', owner);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({
            success: true,
            data: { divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '7.50' },
            message: 'Saldo pendiente actualizado',
        });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects extra payload fields before calling the service', async () => {
        const next = vitest_1.vi.fn();
        await controller_1.divisionEquipoController.updateSaldoPendiente(request({ saldoPendiente: '7.50', extra: true }), response(), next);
        (0, vitest_1.expect)(mocks.updateSaldoPendiente).not.toHaveBeenCalled();
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 422 }));
    });
    (0, vitest_1.it)('forwards the anti-enumeration 404 from the service', async () => {
        const error = Object.assign(new Error('Equipo de la división no encontrado'), { statusCode: 404 });
        mocks.updateSaldoPendiente.mockRejectedValue(error);
        const next = vitest_1.vi.fn();
        await controller_1.divisionEquipoController.updateSaldoPendiente(request({ saldoPendiente: '7.50' }), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(error);
    });
});
(0, vitest_1.describe)('divisionEquipoController.findByDivision', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('returns a public team summary without exposing its owner id', async () => {
        mocks.findByDivision.mockResolvedValue([{
                divisionId: 'division-1',
                equipoId: 'cm-team-ab12',
                saldoPendiente: '0.00',
                equipo: { id: 'cm-team-ab12', nombre: 'Leones', logo: null, userId: owner.id },
            }]);
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.divisionEquipoController.findByDivision(request(undefined), res, next);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({
            success: true,
            data: [{
                    divisionId: 'division-1',
                    equipoId: 'cm-team-ab12',
                    saldoPendiente: '0.00',
                    equipo: { id: 'cm-team-ab12', nombre: 'Leones', logo: null, codigo: 'AB12', esPropio: true },
                }],
        });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.test.js.map
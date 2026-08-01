"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_test_harness_1 = require("./service.test-harness");
const vitest_1 = require("vitest");
const mocks = (0, service_test_harness_1.getServiceMocks)();
let ligaService;
(0, vitest_1.beforeAll)(async () => {
    ligaService = await (0, service_test_harness_1.loadLigaService)();
});
(0, vitest_1.describe)('regla de minimo dos arbitros activos', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, service_test_harness_1.resetServiceMocks)();
        mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: false, usaArbitros: true });
        mocks.arbitroFindFirst.mockResolvedValue({ id: 'arbitro-1', ligaId: 'liga-1', nombre: 'Árbitro 1', activo: true });
        mocks.arbitroUpdate.mockResolvedValue({ id: 'arbitro-1' });
        mocks.partidoArbitroCount.mockResolvedValue(0);
    });
    (0, vitest_1.it)('bloquea desactivar un arbitro cuando solo quedaria uno activo', async () => {
        mocks.arbitroCount.mockResolvedValue(1);
        await (0, vitest_1.expect)(ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, service_test_harness_1.owner))
            .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
        (0, vitest_1.expect)(mocks.arbitroUpdate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite desactivar un arbitro cuando quedan al menos dos activos', async () => {
        mocks.arbitroCount.mockResolvedValue(2);
        await ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.arbitroUpdate).toHaveBeenCalledWith({
            where: { id: 'arbitro-1' },
            data: { activo: false },
        });
    });
    (0, vitest_1.it)('bloquea eliminar un arbitro cuando solo quedaria uno activo', async () => {
        mocks.arbitroCount.mockResolvedValue(1);
        await (0, vitest_1.expect)(ligaService.deleteArbitro('liga-1', 'arbitro-1', service_test_harness_1.owner))
            .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
        (0, vitest_1.expect)(mocks.arbitroDelete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite eliminar un arbitro cuando quedan al menos dos activos', async () => {
        mocks.arbitroCount.mockResolvedValue(2);
        await ligaService.deleteArbitro('liga-1', 'arbitro-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.arbitroDelete).toHaveBeenCalledWith({ where: { id: 'arbitro-1' } });
    });
});
//# sourceMappingURL=service.referee-rules.test.js.map
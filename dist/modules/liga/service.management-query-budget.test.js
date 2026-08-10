"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_test_harness_1 = require("./service.test-harness");
const vitest_1 = require("vitest");
const mocks = (0, service_test_harness_1.getServiceMocks)();
let ligaService;
(0, vitest_1.beforeAll)(async () => {
    ligaService = await (0, service_test_harness_1.loadLigaService)();
});
(0, vitest_1.describe)('presupuesto de consultas privadas de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, service_test_harness_1.resetServiceMocks)();
        mocks.findUpdateContext.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.findDeleteContext.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: true, usaArbitros: true });
        mocks.findManageableArbitros.mockResolvedValue([]);
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.update.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.canchaFindUnique.mockResolvedValue(null);
        mocks.canchaFindFirst
            .mockReset()
            .mockResolvedValueOnce(null)
            .mockResolvedValue({ id: 'cancha-1', ligaId: 'liga-1', nombre: 'Cancha 1', activa: true });
        mocks.canchaCount.mockResolvedValue(2);
        mocks.canchaCreate.mockResolvedValue({ id: 'cancha-1' });
        mocks.canchaUpdate.mockResolvedValue({ id: 'cancha-1' });
        mocks.partidoCount.mockResolvedValue(0);
        mocks.arbitroFindFirst.mockResolvedValue({ id: 'arbitro-1', ligaId: 'liga-1', nombre: 'Arbitro 1', activo: false });
        mocks.arbitroFindUnique.mockResolvedValue(null);
        mocks.arbitroCreate.mockResolvedValue({ id: 'arbitro-2' });
        mocks.arbitroUpdate.mockResolvedValue({ id: 'arbitro-1' });
        mocks.partidoArbitroCount.mockResolvedValue(0);
    });
    (0, vitest_1.it)('usa contextos de actualizacion y eliminacion sin cargar el agregado', async () => {
        await ligaService.update('liga-1', { descripcion: 'actualizada' }, service_test_harness_1.owner);
        await ligaService.delete('liga-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.findUpdateContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findDeleteContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('usa una sola consulta de configuracion por operacion CRUD de cancha', async () => {
        await ligaService.createCancha('liga-1', { nombre: 'Cancha 2' }, service_test_harness_1.owner);
        await ligaService.updateCancha('liga-1', 'cancha-1', { activa: false }, service_test_harness_1.owner);
        await ligaService.deleteCancha('liga-1', 'cancha-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.findManagementContext).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('usa la lista estrecha y una sola consulta de configuracion por CRUD de arbitro', async () => {
        await ligaService.getArbitros('liga-1', service_test_harness_1.owner);
        await ligaService.createArbitro('liga-1', { nombre: 'Arbitro 2' }, service_test_harness_1.owner);
        await ligaService.updateArbitro('liga-1', 'arbitro-1', { nombre: 'Arbitro nuevo' }, service_test_harness_1.owner);
        await ligaService.deleteArbitro('liga-1', 'arbitro-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.findManageableArbitros).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findManagementContext).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.management-query-budget.test.js.map
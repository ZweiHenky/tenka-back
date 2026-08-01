"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_test_harness_1 = require("./service.test-harness");
const vitest_1 = require("vitest");
const mocks = (0, service_test_harness_1.getServiceMocks)();
let ligaService;
(0, vitest_1.beforeAll)(async () => {
    ligaService = await (0, service_test_harness_1.loadLigaService)();
});
(0, vitest_1.describe)('consultas optimizadas de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, service_test_harness_1.resetServiceMocks)();
    });
    vitest_1.it.each([
        ['anonimo', undefined],
        ['propietario', service_test_harness_1.owner],
        ['usuario ajeno', service_test_harness_1.foreignUser],
        ['administrador', service_test_harness_1.admin],
    ])('resuelve el detalle visible con una sola llamada para %s', async (_label, actor) => {
        mocks.findVisibleById.mockResolvedValue(service_test_harness_1.existingLiga);
        await (0, vitest_1.expect)(ligaService.getById('liga-1', actor)).resolves.toBe(service_test_harness_1.existingLiga);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledWith('liga-1', actor);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('devuelve 404 cuando no existe una liga visible', async () => {
        mocks.findVisibleById.mockResolvedValue(null);
        await (0, vitest_1.expect)(ligaService.getById('liga-1', service_test_harness_1.foreignUser)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
    });
    vitest_1.it.each([service_test_harness_1.owner, service_test_harness_1.admin])('devuelve canchas, incluyendo una lista vacia, con una sola llamada', async (actor) => {
        mocks.findManageableCanchas.mockResolvedValue([]);
        await (0, vitest_1.expect)(ligaService.getCanchas('liga-1', actor)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledWith('liga-1', actor);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('oculta canchas de ligas inexistentes o ajenas', async () => {
        mocks.findManageableCanchas.mockResolvedValue(null);
        await (0, vitest_1.expect)(ligaService.getCanchas('liga-1', service_test_harness_1.foreignUser)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=service.read.test.js.map
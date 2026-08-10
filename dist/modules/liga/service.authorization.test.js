"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_test_harness_1 = require("./service.test-harness");
const vitest_1 = require("vitest");
const mocks = (0, service_test_harness_1.getServiceMocks)();
let ligaService;
(0, vitest_1.beforeAll)(async () => {
    ligaService = await (0, service_test_harness_1.loadLigaService)();
});
(0, vitest_1.describe)('autorizacion de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, service_test_harness_1.resetServiceMocks)();
        mocks.findUpdateContext.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.findDeleteContext.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.update.mockImplementation(async (_id, data) => ({ ...service_test_harness_1.existingLiga, ...data }));
    });
    vitest_1.it.each([
        ['update', mocks.findUpdateContext, () => ligaService.update('liga-1', { descripcion: 'ajena' }, service_test_harness_1.foreignUser)],
        ['delete', mocks.findDeleteContext, () => ligaService.delete('liga-1', service_test_harness_1.foreignUser)],
    ])('oculta la liga y no escribe cuando un usuario ajeno intenta %s', async (_operation, contextQuery, action) => {
        contextQuery.mockResolvedValue(null);
        await (0, vitest_1.expect)(action()).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
    });
    vitest_1.it.each([service_test_harness_1.owner, service_test_harness_1.admin])('permite al propietario o administrador actualizar y eliminar', async (actor) => {
        await ligaService.update('liga-1', { descripcion: 'actualizada' }, actor);
        await ligaService.delete('liga-1', actor);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('liga-1');
    });
    (0, vitest_1.it)('devuelve 404 para una programacion inexistente o no autorizada', async () => {
        mocks.findRecentSchedule.mockResolvedValue(null);
        await (0, vitest_1.expect)(ligaService.getRecentSchedule('liga-1', service_test_harness_1.foreignUser)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Liga no encontrado',
        });
        (0, vitest_1.expect)(mocks.findRecentSchedule).toHaveBeenCalledWith('liga-1', service_test_harness_1.foreignUser);
    });
    vitest_1.it.each([service_test_harness_1.owner, service_test_harness_1.admin])('permite consultar la programacion al propietario o administrador', async (actor) => {
        const schedule = { id: 'liga-1', nombre: 'Liga Centro', multiplesCanchas: false, divisiones: [] };
        mocks.findRecentSchedule.mockResolvedValue(schedule);
        await (0, vitest_1.expect)(ligaService.getRecentSchedule('liga-1', actor)).resolves.toBe(schedule);
    });
});
//# sourceMappingURL=service.authorization.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_test_harness_1 = require("./service.test-harness");
const vitest_1 = require("vitest");
const mocks = (0, service_test_harness_1.getServiceMocks)();
let ligaService;
(0, vitest_1.beforeAll)(async () => {
    ligaService = await (0, service_test_harness_1.loadLigaService)();
});
(0, vitest_1.describe)('nombre global unico de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, service_test_harness_1.resetServiceMocks)();
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.findUpdateContext.mockResolvedValue(service_test_harness_1.existingLiga);
        mocks.create.mockImplementation(async (data) => ({ ...service_test_harness_1.existingLiga, id: 'liga-new', ...data }));
        mocks.update.mockImplementation(async (_id, data) => ({ ...service_test_harness_1.existingLiga, ...data }));
    });
    vitest_1.it.each(['user-1', 'user-2'])('rechaza duplicados globales para %s ignorando casing y espacios', async (userId) => {
        mocks.findByNormalizedName.mockResolvedValue(service_test_harness_1.existingLiga);
        await (0, vitest_1.expect)(ligaService.create({
            nombre: '  LIGA CENTRO  ', descripcion: '', ubicacionId: 'ubicacion-1', userId,
        })).rejects.toThrow('Ya existe una liga con ese nombre');
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro');
        (0, vitest_1.expect)(mocks.create).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('normaliza el nombre al crear', async () => {
        await ligaService.create({ nombre: '  Liga Norte  ', descripcion: '', ubicacionId: 'ubicacion-1', userId: 'user-2' });
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            nombre: 'Liga Norte', nombreNormalizado: 'liga norte', userId: 'user-2',
        }), undefined, undefined);
    });
    (0, vitest_1.it)('permite conservar el nombre propio al editar excluyendo la liga actual', async () => {
        await ligaService.update('liga-1', { nombre: ' LIGA CENTRO ' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro', 'liga-1');
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('liga-1', {
            nombre: 'LIGA CENTRO', nombreNormalizado: 'liga centro',
        }, [], undefined);
    });
    (0, vitest_1.it)('rechaza una colision al renombrar', async () => {
        mocks.findByNormalizedName.mockResolvedValue({ ...service_test_harness_1.existingLiga, id: 'liga-2' });
        await (0, vitest_1.expect)(ligaService.update('liga-1', { nombre: 'Liga Norte' }, service_test_harness_1.owner))
            .rejects.toThrow('Ya existe una liga con ese nombre');
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    vitest_1.it.each(['create', 'update'])('convierte P2002 durante %s en ConflictError', async (operation) => {
        mocks[operation].mockRejectedValue({ code: 'P2002' });
        const result = operation === 'create'
            ? ligaService.create({ nombre: 'Liga Norte', descripcion: '', ubicacionId: 'ubicacion-1', userId: 'user-1' })
            : ligaService.update('liga-1', { nombre: 'Liga Norte' }, service_test_harness_1.owner);
        await (0, vitest_1.expect)(result).rejects.toMatchObject({ statusCode: 409, message: 'Ya existe una liga con ese nombre' });
    });
});
//# sourceMappingURL=service.name-uniqueness.test.js.map
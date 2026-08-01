"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findById: vitest_1.vi.fn(),
    findVisibleById: vitest_1.vi.fn(),
    findUpdateContext: vitest_1.vi.fn(),
    findDeleteContext: vitest_1.vi.fn(),
    findManagementContext: vitest_1.vi.fn(),
    findManageableCanchas: vitest_1.vi.fn(),
    findManageableArbitros: vitest_1.vi.fn(),
    findByNormalizedName: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
    arbitroFindFirst: vitest_1.vi.fn(),
    arbitroFindUnique: vitest_1.vi.fn(),
    arbitroCount: vitest_1.vi.fn(),
    arbitroCreate: vitest_1.vi.fn(),
    arbitroUpdate: vitest_1.vi.fn(),
    arbitroDelete: vitest_1.vi.fn(),
    canchaFindUnique: vitest_1.vi.fn(),
    canchaFindFirst: vitest_1.vi.fn(),
    canchaCreate: vitest_1.vi.fn(),
    canchaUpdate: vitest_1.vi.fn(),
    canchaDelete: vitest_1.vi.fn(),
    partidoCount: vitest_1.vi.fn(),
    partidoArbitroCount: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({
    ligaRepository: {
        findById: mocks.findById,
        findVisibleById: mocks.findVisibleById,
        findUpdateContext: mocks.findUpdateContext,
        findDeleteContext: mocks.findDeleteContext,
        findManagementContext: mocks.findManagementContext,
        findManageableCanchas: mocks.findManageableCanchas,
        findManageableArbitros: mocks.findManageableArbitros,
        findByNormalizedName: mocks.findByNormalizedName,
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
    },
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        ligaArbitro: {
            findFirst: mocks.arbitroFindFirst,
            findUnique: mocks.arbitroFindUnique,
            count: mocks.arbitroCount,
            create: mocks.arbitroCreate,
            update: mocks.arbitroUpdate,
            delete: mocks.arbitroDelete,
        },
        ligaCancha: {
            findUnique: mocks.canchaFindUnique,
            findFirst: mocks.canchaFindFirst,
            create: mocks.canchaCreate,
            update: mocks.canchaUpdate,
            delete: mocks.canchaDelete,
        },
        partido: {
            count: mocks.partidoCount,
        },
        partidoArbitro: {
            count: mocks.partidoArbitroCount,
        },
    },
}));
vitest_1.vi.mock('../media/service', () => ({
    mediaService: { scheduleImageCleanup: vitest_1.vi.fn() },
}));
const service_1 = require("./service");
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
const foreignUser = { id: 'user-2', email: 'foreign@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const existingLiga = {
    id: 'liga-1',
    nombre: 'Liga Centro',
    nombreNormalizado: 'liga centro',
    descripcion: '',
    logo: null,
    logoPublicId: null,
    cancha: null,
    canchaPublicId: null,
    multiplesCanchas: false,
    usaArbitros: false,
    canchas: [],
    arbitros: [],
    userId: 'user-1',
    ubicacionId: 'ubicacion-1',
};
(0, vitest_1.describe)('consultas optimizadas de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    vitest_1.it.each([
        ['anonimo', undefined],
        ['propietario', owner],
        ['usuario ajeno', foreignUser],
        ['administrador', admin],
    ])('resuelve el detalle visible con una sola llamada para %s', async (_label, actor) => {
        mocks.findVisibleById.mockResolvedValue(existingLiga);
        await (0, vitest_1.expect)(service_1.ligaService.getById('liga-1', actor)).resolves.toBe(existingLiga);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledWith('liga-1', actor);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('devuelve 404 cuando no existe una liga visible', async () => {
        mocks.findVisibleById.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.ligaService.getById('liga-1', foreignUser)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.findVisibleById).toHaveBeenCalledTimes(1);
    });
    vitest_1.it.each([owner, admin])('devuelve canchas, incluyendo una lista vacia, con una sola llamada', async (actor) => {
        mocks.findManageableCanchas.mockResolvedValue([]);
        await (0, vitest_1.expect)(service_1.ligaService.getCanchas('liga-1', actor)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledWith('liga-1', actor);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('oculta canchas de ligas inexistentes o ajenas', async () => {
        mocks.findManageableCanchas.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.ligaService.getCanchas('liga-1', foreignUser)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
    });
});
(0, vitest_1.describe)('nombre global unico de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.findUpdateContext.mockResolvedValue(existingLiga);
        mocks.create.mockImplementation(async (data) => ({ ...existingLiga, id: 'liga-new', ...data }));
        mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
    });
    vitest_1.it.each(['user-1', 'user-2'])('rechaza duplicados globales para %s ignorando casing y espacios', async (userId) => {
        mocks.findByNormalizedName.mockResolvedValue(existingLiga);
        await (0, vitest_1.expect)(service_1.ligaService.create({
            nombre: '  LIGA CENTRO  ', descripcion: '', ubicacionId: 'ubicacion-1', userId,
        })).rejects.toThrow('Ya existe una liga con ese nombre');
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro');
        (0, vitest_1.expect)(mocks.create).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('normaliza el nombre al crear', async () => {
        await service_1.ligaService.create({ nombre: '  Liga Norte  ', descripcion: '', ubicacionId: 'ubicacion-1', userId: 'user-2' });
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            nombre: 'Liga Norte', nombreNormalizado: 'liga norte', userId: 'user-2',
        }), undefined, undefined);
    });
    (0, vitest_1.it)('permite conservar el nombre propio al editar excluyendo la liga actual', async () => {
        await service_1.ligaService.update('liga-1', { nombre: ' LIGA CENTRO ' }, owner);
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro', 'liga-1');
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('liga-1', {
            nombre: 'LIGA CENTRO', nombreNormalizado: 'liga centro',
        }, undefined, undefined);
    });
    (0, vitest_1.it)('rechaza una colision al renombrar', async () => {
        mocks.findByNormalizedName.mockResolvedValue({ ...existingLiga, id: 'liga-2' });
        await (0, vitest_1.expect)(service_1.ligaService.update('liga-1', { nombre: 'Liga Norte' }, owner))
            .rejects.toThrow('Ya existe una liga con ese nombre');
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    vitest_1.it.each(['create', 'update'])('convierte P2002 durante %s en ConflictError', async (operation) => {
        mocks[operation].mockRejectedValue({ code: 'P2002' });
        const result = operation === 'create'
            ? service_1.ligaService.create({ nombre: 'Liga Norte', descripcion: '', ubicacionId: 'ubicacion-1', userId: 'user-1' })
            : service_1.ligaService.update('liga-1', { nombre: 'Liga Norte' }, owner);
        await (0, vitest_1.expect)(result).rejects.toMatchObject({ statusCode: 409, message: 'Ya existe una liga con ese nombre' });
    });
});
(0, vitest_1.describe)('autorizacion de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findUpdateContext.mockResolvedValue(existingLiga);
        mocks.findDeleteContext.mockResolvedValue(existingLiga);
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
    });
    vitest_1.it.each([
        ['update', mocks.findUpdateContext, () => service_1.ligaService.update('liga-1', { descripcion: 'ajena' }, foreignUser)],
        ['delete', mocks.findDeleteContext, () => service_1.ligaService.delete('liga-1', foreignUser)],
    ])('oculta la liga y no escribe cuando un usuario ajeno intenta %s', async (_operation, contextQuery, action) => {
        contextQuery.mockResolvedValue(null);
        await (0, vitest_1.expect)(action()).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
    });
    vitest_1.it.each([owner, admin])('permite al propietario o administrador actualizar y eliminar', async (actor) => {
        await service_1.ligaService.update('liga-1', { descripcion: 'actualizada' }, actor);
        await service_1.ligaService.delete('liga-1', actor);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('liga-1');
    });
});
(0, vitest_1.describe)('regla de minimo dos arbitros activos', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: false, usaArbitros: true });
        mocks.arbitroFindFirst.mockResolvedValue({ id: 'arbitro-1', ligaId: 'liga-1', nombre: 'Árbitro 1', activo: true });
        mocks.arbitroUpdate.mockResolvedValue({ id: 'arbitro-1' });
        mocks.partidoArbitroCount.mockResolvedValue(0);
    });
    (0, vitest_1.it)('bloquea desactivar un arbitro cuando solo quedaria uno activo', async () => {
        mocks.arbitroCount.mockResolvedValue(1);
        await (0, vitest_1.expect)(service_1.ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, owner))
            .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
        (0, vitest_1.expect)(mocks.arbitroUpdate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite desactivar un arbitro cuando quedan al menos dos activos', async () => {
        mocks.arbitroCount.mockResolvedValue(2);
        await service_1.ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, owner);
        (0, vitest_1.expect)(mocks.arbitroUpdate).toHaveBeenCalledWith({
            where: { id: 'arbitro-1' },
            data: { activo: false },
        });
    });
    (0, vitest_1.it)('bloquea eliminar un arbitro cuando solo quedaria uno activo', async () => {
        mocks.arbitroCount.mockResolvedValue(1);
        await (0, vitest_1.expect)(service_1.ligaService.deleteArbitro('liga-1', 'arbitro-1', owner))
            .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
        (0, vitest_1.expect)(mocks.arbitroDelete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite eliminar un arbitro cuando quedan al menos dos activos', async () => {
        mocks.arbitroCount.mockResolvedValue(2);
        await service_1.ligaService.deleteArbitro('liga-1', 'arbitro-1', owner);
        (0, vitest_1.expect)(mocks.arbitroDelete).toHaveBeenCalledWith({ where: { id: 'arbitro-1' } });
    });
});
(0, vitest_1.describe)('presupuesto de consultas privadas de liga', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findUpdateContext.mockResolvedValue(existingLiga);
        mocks.findDeleteContext.mockResolvedValue(existingLiga);
        mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: true, usaArbitros: true });
        mocks.findManageableArbitros.mockResolvedValue([]);
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.update.mockResolvedValue(existingLiga);
        mocks.canchaFindUnique.mockResolvedValue(null);
        mocks.canchaFindFirst.mockResolvedValue({ id: 'cancha-1', ligaId: 'liga-1', nombre: 'Cancha 1', activa: true });
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
        await service_1.ligaService.update('liga-1', { descripcion: 'actualizada' }, owner);
        await service_1.ligaService.delete('liga-1', owner);
        (0, vitest_1.expect)(mocks.findUpdateContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findDeleteContext).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('usa una sola consulta de configuracion por operacion CRUD de cancha', async () => {
        await service_1.ligaService.createCancha('liga-1', { nombre: 'Cancha 2' }, owner);
        await service_1.ligaService.updateCancha('liga-1', 'cancha-1', { activa: false }, owner);
        await service_1.ligaService.deleteCancha('liga-1', 'cancha-1', owner);
        (0, vitest_1.expect)(mocks.findManagementContext).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('usa la lista estrecha y una sola consulta de configuracion por CRUD de arbitro', async () => {
        await service_1.ligaService.getArbitros('liga-1', owner);
        await service_1.ligaService.createArbitro('liga-1', { nombre: 'Arbitro 2' }, owner);
        await service_1.ligaService.updateArbitro('liga-1', 'arbitro-1', { nombre: 'Arbitro nuevo' }, owner);
        await service_1.ligaService.deleteArbitro('liga-1', 'arbitro-1', owner);
        (0, vitest_1.expect)(mocks.findManageableArbitros).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.findManagementContext).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(mocks.findById).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map
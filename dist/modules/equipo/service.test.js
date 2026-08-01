"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findAll: vitest_1.vi.fn(),
    findByUser: vitest_1.vi.fn(),
    findById: vitest_1.vi.fn(),
    findByNormalizedName: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({ equipoRepository: mocks }));
vitest_1.vi.mock('../media/service', () => ({
    mediaService: { scheduleImageCleanup: vitest_1.vi.fn() },
}));
const service_1 = require("./service");
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'CAPITAN' };
const foreignUser = { id: 'user-2', email: 'foreign@test.com', rol: 'CAPITAN' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const existing = {
    id: 'team-1',
    nombre: 'Halcones',
    nombreNormalizado: 'halcones',
    logo: null,
    logoPublicId: null,
    userId: 'user-1',
};
(0, vitest_1.describe)('equipoService nombre unico por usuario', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.findByNormalizedName.mockResolvedValue(null);
        mocks.findById.mockResolvedValue(existing);
        mocks.create.mockImplementation(async (data) => ({ id: 'new-team', logo: null, logoPublicId: null, ...data }));
        mocks.update.mockImplementation(async (_id, data) => ({ ...existing, ...data }));
    });
    (0, vitest_1.it)('rechaza un nombre duplicado para el mismo usuario ignorando mayusculas y espacios', async () => {
        mocks.findByNormalizedName.mockResolvedValue(existing);
        await (0, vitest_1.expect)(service_1.equipoService.create({ nombre: '  HALCONES  ', userId: 'user-1' }))
            .rejects.toThrow('Ya tienes un equipo con ese nombre');
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'halcones');
        (0, vitest_1.expect)(mocks.create).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite el mismo nombre a otro usuario', async () => {
        await service_1.equipoService.create({ nombre: ' Halcones ', userId: 'user-2' });
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('user-2', 'halcones');
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledWith({ nombre: 'Halcones', nombreNormalizado: 'halcones', userId: 'user-2' });
    });
    (0, vitest_1.it)('permite conservar el nombre propio al editar', async () => {
        await service_1.equipoService.update('team-1', { nombre: ' HALCONES ' }, owner);
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'halcones', 'team-1');
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('team-1', { nombre: 'HALCONES', nombreNormalizado: 'halcones' });
    });
    (0, vitest_1.it)('rechaza una colision al renombrar usando el propietario anterior', async () => {
        mocks.findByNormalizedName.mockResolvedValue({ ...existing, id: 'team-2' });
        await (0, vitest_1.expect)(service_1.equipoService.update('team-1', { nombre: ' Leones ', userId: 'user-2' }, owner))
            .rejects.toThrow('Ya tienes un equipo con ese nombre');
        (0, vitest_1.expect)(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'leones', 'team-1');
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('convierte P2002 durante create en ConflictError', async () => {
        mocks.create.mockRejectedValue({ code: 'P2002' });
        await (0, vitest_1.expect)(service_1.equipoService.create({ nombre: 'Halcones', userId: 'user-1' }))
            .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
    });
    (0, vitest_1.it)('convierte P2002 durante update en ConflictError', async () => {
        mocks.update.mockRejectedValue({ code: 'P2002' });
        await (0, vitest_1.expect)(service_1.equipoService.update('team-1', { nombre: 'Leones' }, owner))
            .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
    });
    vitest_1.it.each([
        ['update', () => service_1.equipoService.update('team-1', { nombre: 'Leones' }, foreignUser)],
        ['delete', () => service_1.equipoService.delete('team-1', foreignUser)],
    ])('oculta el equipo y no escribe cuando un usuario ajeno intenta %s', async (_operation, action) => {
        await (0, vitest_1.expect)(action()).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
    });
    vitest_1.it.each([owner, admin])('permite al propietario o administrador actualizar y eliminar', async (actor) => {
        await service_1.equipoService.update('team-1', { nombre: 'Leones' }, actor);
        await service_1.equipoService.delete('team-1', actor);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('team-1');
    });
});
//# sourceMappingURL=service.test.js.map
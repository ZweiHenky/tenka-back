import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findByUser: vi.fn(),
  findById: vi.fn(),
  findByNormalizedName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  txFindFirst: vi.fn(),
  acquireAccountQuotaLock: vi.fn(),
  assertAccountQuotaDelta: vi.fn(),
}));

vi.mock('./repository', () => ({ equipoRepository: mocks }));
vi.mock('../../config/database', () => ({ prisma: { equipo: { findFirst: mocks.txFindFirst } } }));
vi.mock('../../utils/accountQuota', () => ({
  acquireAccountQuotaLock: mocks.acquireAccountQuotaLock,
  assertAccountQuotaDelta: mocks.assertAccountQuotaDelta,
}));
vi.mock('../media/service', () => ({
  mediaService: { scheduleImageCleanup: vi.fn() },
}));

import { equipoService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'user-1', email: 'owner@test.com', rol: 'CAPITAN' };
const foreignUser: AuthenticatedUser = { id: 'user-2', email: 'foreign@test.com', rol: 'CAPITAN' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

const existing = {
  id: 'team-1',
  nombre: 'Halcones',
  nombreNormalizado: 'halcones',
  logo: null,
  logoPublicId: null,
  userId: 'user-1',
};

describe('equipoService nombre unico por usuario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByNormalizedName.mockResolvedValue(null);
    mocks.txFindFirst.mockResolvedValue(null);
    mocks.findById.mockResolvedValue(existing);
    mocks.create.mockImplementation(async (data) => ({ id: 'new-team', logo: null, logoPublicId: null, ...data }));
    mocks.update.mockImplementation(async (_id, data) => ({ ...existing, ...data }));
  });

  it('rechaza un nombre duplicado para el mismo usuario ignorando mayusculas y espacios', async () => {
    mocks.txFindFirst.mockResolvedValue(existing);

    await expect(equipoService.create({ nombre: '  HALCONES  ' }, owner))
      .rejects.toThrow('Ya tienes un equipo con ese nombre');
    expect(mocks.txFindFirst).toHaveBeenCalledWith({ where: { userId: 'user-1', nombreNormalizado: 'halcones' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('permite el mismo nombre a otro usuario', async () => {
    await equipoService.create({ nombre: ' Halcones ' }, foreignUser);

    expect(mocks.txFindFirst).toHaveBeenCalledWith({ where: { userId: 'user-2', nombreNormalizado: 'halcones' } });
    expect(mocks.create).toHaveBeenCalledWith({ nombre: 'Halcones', nombreNormalizado: 'halcones', userId: 'user-2' }, expect.anything());
    expect(mocks.acquireAccountQuotaLock).toHaveBeenCalledWith(expect.anything(), 'user-2');
    expect(mocks.assertAccountQuotaDelta).toHaveBeenCalledWith(expect.anything(), 'user-2', { teams: 1 });
  });

  it('permite conservar el nombre propio al editar', async () => {
    await equipoService.update('team-1', { nombre: ' HALCONES ' }, owner);

    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'halcones', 'team-1');
    expect(mocks.update).toHaveBeenCalledWith('team-1', { nombre: 'HALCONES', nombreNormalizado: 'halcones' });
  });

  it('rechaza una colision al renombrar usando el propietario anterior', async () => {
    mocks.findByNormalizedName.mockResolvedValue({ ...existing, id: 'team-2' });

    await expect(equipoService.update('team-1', { nombre: ' Leones ', userId: 'user-2' }, owner))
      .rejects.toThrow('Ya tienes un equipo con ese nombre');
    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'leones', 'team-1');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('convierte P2002 durante create en ConflictError', async () => {
    mocks.create.mockRejectedValue({ code: 'P2002' });

    await expect(equipoService.create({ nombre: 'Halcones' }, owner))
      .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
  });

  it('convierte P2002 durante update en ConflictError', async () => {
    mocks.update.mockRejectedValue({ code: 'P2002' });

    await expect(equipoService.update('team-1', { nombre: 'Leones' }, owner))
      .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
  });

  it('never transfers ownership through update service input', async () => {
    await equipoService.update('team-1', { nombre: 'Leones', userId: 'user-2' }, owner);
    expect(mocks.update).toHaveBeenCalledWith('team-1', { nombre: 'Leones', nombreNormalizado: 'leones' });
  });

  it.each([
    ['update', () => equipoService.update('team-1', { nombre: 'Leones' }, foreignUser)],
    ['delete', () => equipoService.delete('team-1', foreignUser)],
  ])('oculta el equipo y no escribe cuando un usuario ajeno intenta %s', async (_operation, action) => {
    await expect(action()).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each([owner, admin])('permite al propietario o administrador actualizar y eliminar', async (actor) => {
    await equipoService.update('team-1', { nombre: 'Leones' }, actor);
    await equipoService.delete('team-1', actor);

    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledWith('team-1');
  });
});

describe('segunda condicion de eliminacion de equipo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue(existing);
  });

  it('permite eliminar cuando el nombre escrito coincide (ignorando mayusculas)', async () => {
    await expect(equipoService.delete('team-1', owner, 'halCONES')).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledWith('team-1');
  });

  it('rechaza la eliminacion cuando el nombre no coincide', async () => {
    await expect(equipoService.delete('team-1', owner, 'otro equipo')).rejects.toMatchObject({
      statusCode: 422,
      message: 'El nombre no coincide. Escribe el nombre del equipo para confirmar.',
    });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('mantiene la eliminacion directa cuando no se exige el nombre', async () => {
    await expect(equipoService.delete('team-1', owner)).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledWith('team-1');
  });
});

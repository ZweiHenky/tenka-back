import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findByUser: vi.fn(),
  findById: vi.fn(),
  findByNormalizedName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./repository', () => ({ equipoRepository: mocks }));
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
    mocks.findById.mockResolvedValue(existing);
    mocks.create.mockImplementation(async (data) => ({ id: 'new-team', logo: null, logoPublicId: null, ...data }));
    mocks.update.mockImplementation(async (_id, data) => ({ ...existing, ...data }));
  });

  it('rechaza un nombre duplicado para el mismo usuario ignorando mayusculas y espacios', async () => {
    mocks.findByNormalizedName.mockResolvedValue(existing);

    await expect(equipoService.create({ nombre: '  HALCONES  ', userId: 'user-1' }))
      .rejects.toThrow('Ya tienes un equipo con ese nombre');
    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('user-1', 'halcones');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('permite el mismo nombre a otro usuario', async () => {
    await equipoService.create({ nombre: ' Halcones ', userId: 'user-2' });

    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('user-2', 'halcones');
    expect(mocks.create).toHaveBeenCalledWith({ nombre: 'Halcones', nombreNormalizado: 'halcones', userId: 'user-2' });
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

    await expect(equipoService.create({ nombre: 'Halcones', userId: 'user-1' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
  });

  it('convierte P2002 durante update en ConflictError', async () => {
    mocks.update.mockRejectedValue({ code: 'P2002' });

    await expect(equipoService.update('team-1', { nombre: 'Leones' }, owner))
      .rejects.toMatchObject({ statusCode: 409, message: 'Ya tienes un equipo con ese nombre' });
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

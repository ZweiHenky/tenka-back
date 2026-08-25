import {
  existingLiga,
  getServiceMocks,
  loadLigaService,
  owner,
  resetServiceMocks,
} from './service.test-harness';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const mocks = getServiceMocks();
let ligaService: Awaited<ReturnType<typeof loadLigaService>>;

beforeAll(async () => {
  ligaService = await loadLigaService();
});

describe('nombre global unico de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findByNormalizedName.mockResolvedValue(null);
    mocks.findUpdateContext.mockResolvedValue(existingLiga);
    mocks.create.mockImplementation(async (data) => ({ ...existingLiga, id: 'liga-new', ...data }));
    mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
  });

  it.each(['user-1', 'user-2'])('rechaza duplicados globales para %s ignorando casing y espacios', async (userId) => {
    mocks.findByNormalizedName.mockResolvedValue(existingLiga);

    await expect(ligaService.create({
      nombre: '  LIGA CENTRO  ', descripcion: '', ubicacionId: 'ubicacion-1',
    }, { ...owner, id: userId })).rejects.toThrow('Ya existe una liga con ese nombre');
    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('normaliza el nombre al crear', async () => {
    await ligaService.create({ nombre: '  Liga Norte  ', descripcion: '', ubicacionId: 'ubicacion-1' }, { ...owner, id: 'user-2' });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      nombre: 'Liga Norte', nombreNormalizado: 'liga norte', userId: 'user-2',
    }), undefined, undefined, expect.anything());
    expect(mocks.acquireAccountQuotaLock).toHaveBeenCalledWith(expect.anything(), 'user-2');
    expect(mocks.assertAccountQuotaDelta).toHaveBeenCalledWith(expect.anything(), 'user-2', { leagues: 1 });
  });

  it('permite conservar el nombre propio al editar excluyendo la liga actual', async () => {
    await ligaService.update('liga-1', { nombre: ' LIGA CENTRO ' }, owner);

    expect(mocks.findByNormalizedName).toHaveBeenCalledWith('liga centro', 'liga-1');
    expect(mocks.update).toHaveBeenCalledWith('liga-1', {
      nombre: 'LIGA CENTRO', nombreNormalizado: 'liga centro',
    }, [], undefined);
  });

  it('rechaza una colision al renombrar', async () => {
    mocks.findByNormalizedName.mockResolvedValue({ ...existingLiga, id: 'liga-2' });

    await expect(ligaService.update('liga-1', { nombre: 'Liga Norte' }, owner))
      .rejects.toThrow('Ya existe una liga con ese nombre');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('never transfers ownership through update service input', async () => {
    await ligaService.update('liga-1', { descripcion: 'Nueva', userId: 'other-user' } as any, owner);
    expect(mocks.update).toHaveBeenCalledWith('liga-1', { descripcion: 'Nueva' }, [], undefined);
  });

  it.each(['create', 'update'] as const)('convierte P2002 durante %s en ConflictError', async (operation) => {
    mocks[operation].mockRejectedValue({ code: 'P2002' });

    const result = operation === 'create'
      ? ligaService.create({ nombre: 'Liga Norte', descripcion: '', ubicacionId: 'ubicacion-1' }, owner)
      : ligaService.update('liga-1', { nombre: 'Liga Norte' }, owner);
    await expect(result).rejects.toMatchObject({ statusCode: 409, message: 'Ya existe una liga con ese nombre' });
  });
});

import {
  admin,
  existingLiga,
  foreignUser,
  getServiceMocks,
  loadLigaService,
  owner,
  resetServiceMocks,
} from './service.test-harness';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../utils/errors';

const mocks = getServiceMocks();
let ligaService: Awaited<ReturnType<typeof loadLigaService>>;

beforeAll(async () => {
  ligaService = await loadLigaService();
});

describe('autorizacion de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findUpdateContext.mockResolvedValue(existingLiga);
    mocks.findDeleteContext.mockResolvedValue(existingLiga);
    mocks.findByNormalizedName.mockResolvedValue(null);
    mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
  });

  it.each([
    ['update', mocks.findUpdateContext, () => ligaService.update('liga-1', { descripcion: 'ajena' }, foreignUser)],
    ['delete', mocks.findDeleteContext, () => ligaService.delete('liga-1', foreignUser)],
  ])('oculta la liga y no escribe cuando un usuario ajeno intenta %s', async (_operation, contextQuery, action) => {
    contextQuery.mockResolvedValue(null);
    await expect(action()).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each([owner, admin])('permite al propietario o administrador actualizar y eliminar', async (actor) => {
    await ligaService.update('liga-1', { descripcion: 'actualizada' }, actor);
    await ligaService.delete('liga-1', actor);

    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledWith('liga-1');
  });

  it('devuelve 404 para una programacion inexistente o no autorizada', async () => {
    mocks.findRecentSchedule.mockResolvedValue(null);

    await expect(ligaService.getRecentSchedule('liga-1', foreignUser)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Liga no encontrado',
    });
    expect(mocks.findRecentSchedule).toHaveBeenCalledWith('liga-1', foreignUser);
  });

  it.each([owner, admin])('permite consultar la programacion al propietario o administrador', async (actor) => {
    const schedule = { id: 'liga-1', nombre: 'Liga Centro', multiplesCanchas: false, divisiones: [] };
    mocks.findRecentSchedule.mockResolvedValue(schedule);

    await expect(ligaService.getRecentSchedule('liga-1', actor)).resolves.toBe(schedule);
  });
});

describe('segunda condicion de eliminacion de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findDeleteContext.mockResolvedValue(existingLiga);
  });

  it('permite eliminar cuando el nombre escrito coincide (ignorando mayusculas)', async () => {
    await expect(ligaService.delete('liga-1', owner, 'liga CENTRO')).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledWith('liga-1');
  });

  it('rechaza la eliminacion cuando el nombre no coincide', async () => {
    await expect(ligaService.delete('liga-1', owner, 'otra liga')).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('mantiene la eliminacion directa cuando no se exige el nombre', async () => {
    await expect(ligaService.delete('liga-1', owner)).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledWith('liga-1');
  });
});

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

const mocks = getServiceMocks();
let ligaService: Awaited<ReturnType<typeof loadLigaService>>;

beforeAll(async () => {
  ligaService = await loadLigaService();
});

describe('consultas optimizadas de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it.each([
    ['anonimo', undefined],
    ['propietario', owner],
    ['usuario ajeno', foreignUser],
    ['administrador', admin],
  ])('resuelve el detalle visible con una sola llamada para %s', async (_label, actor) => {
    mocks.findVisibleById.mockResolvedValue(existingLiga);

    await expect(ligaService.getById('liga-1', actor)).resolves.toBe(existingLiga);

    expect(mocks.findVisibleById).toHaveBeenCalledTimes(1);
    expect(mocks.findVisibleById).toHaveBeenCalledWith('liga-1', actor);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('devuelve 404 cuando no existe una liga visible', async () => {
    mocks.findVisibleById.mockResolvedValue(null);

    await expect(ligaService.getById('liga-1', foreignUser)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findVisibleById).toHaveBeenCalledTimes(1);
  });

  it.each([owner, admin])('devuelve canchas, incluyendo una lista vacia, con una sola llamada', async (actor) => {
    mocks.findManageableCanchas.mockResolvedValue([]);

    await expect(ligaService.getCanchas('liga-1', actor)).resolves.toEqual([]);
    expect(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
    expect(mocks.findManageableCanchas).toHaveBeenCalledWith('liga-1', actor);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('oculta canchas de ligas inexistentes o ajenas', async () => {
    mocks.findManageableCanchas.mockResolvedValue(null);

    await expect(ligaService.getCanchas('liga-1', foreignUser)).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findManageableCanchas).toHaveBeenCalledTimes(1);
  });
});

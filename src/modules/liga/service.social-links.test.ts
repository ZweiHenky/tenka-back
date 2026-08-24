import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  existingLiga,
  getServiceMocks,
  loadLigaService,
  owner,
  resetServiceMocks,
} from './service.test-harness';

const mocks = getServiceMocks();
let ligaService: Awaited<ReturnType<typeof loadLigaService>>;

beforeAll(async () => {
  ligaService = await loadLigaService();
});

describe('redes sociales de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findByNormalizedName.mockResolvedValue(null);
    mocks.findUpdateContext.mockResolvedValue(existingLiga);
    mocks.create.mockImplementation(async (data) => ({ ...existingLiga, ...data }));
    mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
  });

  it('guarda los enlaces al crear la liga', async () => {
    await ligaService.create({
      nombre: 'Liga Social',
      descripcion: '',
      ubicacionId: 'ubicacion-1',
      userId: owner.id,
      facebook: 'https://facebook.com/liga-social',
      x: 'https://x.com/liga_social',
      instagram: 'https://instagram.com/liga.social',
      tiktok: 'https://tiktok.com/@liga_social',
    });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      facebook: 'https://facebook.com/liga-social',
      x: 'https://x.com/liga_social',
      instagram: 'https://instagram.com/liga.social',
      tiktok: 'https://tiktok.com/@liga_social',
    }), undefined, undefined);
  });

  it('actualiza un enlace y elimina otro con null', async () => {
    await ligaService.update('liga-1', {
      instagram: 'https://instagram.com/nueva_liga',
      tiktok: null,
    }, owner);

    expect(mocks.update).toHaveBeenCalledWith('liga-1', {
      instagram: 'https://instagram.com/nueva_liga',
      tiktok: null,
    }, [], undefined);
  });
});

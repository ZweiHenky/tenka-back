import {
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

describe('regla de minimo dos arbitros activos', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: false, usaArbitros: true });
    mocks.arbitroFindFirst.mockResolvedValue({ id: 'arbitro-1', ligaId: 'liga-1', nombre: 'Árbitro 1', activo: true });
    mocks.arbitroUpdate.mockResolvedValue({ id: 'arbitro-1' });
    mocks.partidoArbitroCount.mockResolvedValue(0);
  });

  it('bloquea desactivar un arbitro cuando solo quedaria uno activo', async () => {
    mocks.arbitroCount.mockResolvedValue(1);

    await expect(ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, owner))
      .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
    expect(mocks.arbitroUpdate).not.toHaveBeenCalled();
  });

  it('permite desactivar un arbitro cuando quedan al menos dos activos', async () => {
    mocks.arbitroCount.mockResolvedValue(2);

    await ligaService.updateArbitro('liga-1', 'arbitro-1', { activo: false }, owner);

    expect(mocks.arbitroUpdate).toHaveBeenCalledWith({
      where: { id: 'arbitro-1' },
      data: { activo: false },
    });
  });

  it('bloquea eliminar un arbitro cuando solo quedaria uno activo', async () => {
    mocks.arbitroCount.mockResolvedValue(1);

    await expect(ligaService.deleteArbitro('liga-1', 'arbitro-1', owner))
      .rejects.toThrow('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
    expect(mocks.arbitroDelete).not.toHaveBeenCalled();
  });

  it('permite eliminar un arbitro cuando quedan al menos dos activos', async () => {
    mocks.arbitroCount.mockResolvedValue(2);

    await ligaService.deleteArbitro('liga-1', 'arbitro-1', owner);

    expect(mocks.arbitroDelete).toHaveBeenCalledWith({ where: { id: 'arbitro-1' } });
  });
});

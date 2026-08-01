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

describe('presupuesto de consultas privadas de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
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

  it('usa contextos de actualizacion y eliminacion sin cargar el agregado', async () => {
    await ligaService.update('liga-1', { descripcion: 'actualizada' }, owner);
    await ligaService.delete('liga-1', owner);

    expect(mocks.findUpdateContext).toHaveBeenCalledOnce();
    expect(mocks.findDeleteContext).toHaveBeenCalledOnce();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('usa una sola consulta de configuracion por operacion CRUD de cancha', async () => {
    await ligaService.createCancha('liga-1', { nombre: 'Cancha 2' }, owner);
    await ligaService.updateCancha('liga-1', 'cancha-1', { activa: false }, owner);
    await ligaService.deleteCancha('liga-1', 'cancha-1', owner);

    expect(mocks.findManagementContext).toHaveBeenCalledTimes(3);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('usa la lista estrecha y una sola consulta de configuracion por CRUD de arbitro', async () => {
    await ligaService.getArbitros('liga-1', owner);
    await ligaService.createArbitro('liga-1', { nombre: 'Arbitro 2' }, owner);
    await ligaService.updateArbitro('liga-1', 'arbitro-1', { nombre: 'Arbitro nuevo' }, owner);
    await ligaService.deleteArbitro('liga-1', 'arbitro-1', owner);

    expect(mocks.findManageableArbitros).toHaveBeenCalledOnce();
    expect(mocks.findManagementContext).toHaveBeenCalledTimes(3);
    expect(mocks.findById).not.toHaveBeenCalled();
  });
});

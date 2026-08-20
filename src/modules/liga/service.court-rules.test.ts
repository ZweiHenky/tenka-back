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

const courts = [
  { id: 'court-1', nombre: 'Principal', nombreNormalizado: 'principal', activa: true },
  { id: 'court-2', nombre: 'Norte', nombreNormalizado: 'norte', activa: true },
  { id: 'court-3', nombre: 'Historica', nombreNormalizado: 'historica', activa: false },
];

beforeAll(async () => {
  ligaService = await loadLigaService();
});

describe('gestion de canchas de liga', () => {
  beforeEach(() => {
    resetServiceMocks();
    mocks.findByNormalizedName.mockResolvedValue(null);
    mocks.findUpdateContext.mockResolvedValue({ ...existingLiga, multiplesCanchas: true, canchas: courts });
    mocks.findManagementContext.mockResolvedValue({ multiplesCanchas: true, usaArbitros: false });
    mocks.update.mockImplementation(async (_id, data) => ({ ...existingLiga, ...data }));
    mocks.canchaFindFirst.mockResolvedValue(null);
    mocks.canchaCount.mockResolvedValue(2);
    mocks.canchaCreate.mockResolvedValue({ id: 'court-4' });
    mocks.divisionCount.mockResolvedValue(0);
  });

  it('actualiza por id, crea nuevas y desactiva las omitidas sin eliminarlas', async () => {
    await ligaService.update('liga-1', {
      canchas: [
        { id: 'court-1', nombre: ' Central ' },
        { id: 'court-2' },
        { nombre: 'Sur' },
      ],
    }, owner);

    // Court writes go through the league schedule lock, so the repository receives the
    // transaction client plus the disablingMultipleCourts flag.
    expect(mocks.update).toHaveBeenCalledWith('liga-1', {}, [
      expect.objectContaining({ id: 'court-1', nombre: 'Central', nombreNormalizado: 'central', activa: true }),
      expect.objectContaining({ id: 'court-2', nombre: 'Norte', activa: true }),
      expect.objectContaining({ id: 'court-3', nombre: 'Historica', activa: false }),
      { nombre: 'Sur', nombreNormalizado: 'sur', activa: true },
    ], undefined, false, expect.anything());
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'liga-1');
  });

  it('al deshabilitar multiples canchas conserva y desactiva todos los registros', async () => {
    await ligaService.update('liga-1', { multiplesCanchas: false }, owner);

    const writes = mocks.update.mock.calls[0][2];
    expect(writes).toHaveLength(3);
    expect(writes.every((court: { activa: boolean }) => court.activa === false)).toBe(true);
    expect(mocks.update.mock.calls[0][4]).toBe(true);
  });

  it('toma el lock de liga antes de contar partidos y borrar una cancha', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    mocks.partidoCount.mockResolvedValue(0);

    await ligaService.deleteCancha('liga-1', 'court-1', owner);

    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'liga-1');
    const lockOrder = mocks.executeRawUnsafe.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(mocks.partidoCount.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(mocks.divisionCount.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(mocks.canchaDelete.mock.invocationCallOrder[0]);
  });

  it('desactiva la cancha cuando la relectura bajo el lock encuentra partidos', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    // A concurrent generateNext committed matches after the caller's earlier read.
    mocks.partidoCount.mockResolvedValue(1);

    await ligaService.deleteCancha('liga-1', 'court-1', owner);

    expect(mocks.canchaUpdate).toHaveBeenCalledWith({ where: { id: 'court-1' }, data: { activa: false } });
    expect(mocks.canchaDelete).not.toHaveBeenCalled();
  });

  it('toma el lock de liga antes de validar la desactivacion de una cancha', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    mocks.canchaCount.mockResolvedValue(2);
    mocks.canchaUpdate.mockResolvedValue({ ...courts[0], activa: false });

    await ligaService.updateCancha('liga-1', 'court-1', { activa: false }, owner);

    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'liga-1');
    expect(mocks.executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.canchaCount.mock.invocationCallOrder[0]);
  });

  it('no toma el lock cuando la edicion no toca canchas', async () => {
    mocks.findUpdateContext.mockResolvedValue({ ...existingLiga, multiplesCanchas: true, canchas: courts });

    await ligaService.update('liga-1', { descripcion: 'Solo texto' }, owner);

    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('rechaza ids ajenos y nombres normalizados duplicados', async () => {
    await expect(ligaService.update('liga-1', {
      canchas: [{ id: 'foreign', nombre: 'Otra' }, { id: 'court-1' }],
    }, owner)).rejects.toThrow('La cancha indicada no pertenece a esta liga');

    await expect(ligaService.update('liga-1', {
      canchas: [{ id: 'court-1' }, { id: 'court-2', nombre: ' principal ' }],
    }, owner)).rejects.toThrow('Ya existe una cancha con ese nombre en esta liga');
  });

  it('impide desactivar o eliminar una cancha activa si quedaria solo una', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    mocks.canchaCount.mockResolvedValue(1);

    await expect(ligaService.updateCancha('liga-1', 'court-1', { activa: false }, owner))
      .rejects.toThrow('debe conservar al menos 2 canchas activas');
    await expect(ligaService.deleteCancha('liga-1', 'court-1', owner))
      .rejects.toThrow('debe conservar al menos 2 canchas activas');
  });

  it('recorta y normaliza nombres en el CRUD individual', async () => {
    await ligaService.createCancha('liga-1', { nombre: '  Cancha Sur  ' }, owner);

    expect(mocks.canchaCreate).toHaveBeenCalledWith({
      data: { ligaId: 'liga-1', nombre: 'Cancha Sur', nombreNormalizado: 'cancha sur' },
    });
  });

  it('desactiva una cancha usada y elimina fisicamente una sin partidos', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    mocks.partidoCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await ligaService.deleteCancha('liga-1', 'court-1', owner);
    await ligaService.deleteCancha('liga-1', 'court-1', owner);

    expect(mocks.canchaUpdate).toHaveBeenCalledWith({ where: { id: 'court-1' }, data: { activa: false } });
    expect(mocks.canchaDelete).toHaveBeenCalledWith({ where: { id: 'court-1' } });
  });

  it('desactiva en lugar de eliminar una cancha fija de una división', async () => {
    mocks.canchaFindFirst.mockResolvedValue(courts[0]);
    mocks.partidoCount.mockResolvedValue(0);
    mocks.divisionCount.mockResolvedValue(1);

    await ligaService.deleteCancha('liga-1', 'court-1', owner);

    expect(mocks.canchaUpdate).toHaveBeenCalledWith({ where: { id: 'court-1' }, data: { activa: false } });
    expect(mocks.canchaDelete).not.toHaveBeenCalled();
  });
});

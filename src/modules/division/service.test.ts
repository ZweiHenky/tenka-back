import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ligaFindFirst: vi.fn(),
  divisionFindFirst: vi.fn(),
  estadoLigaFindFirstOrThrow: vi.fn(),
  transaction: vi.fn(),
  subscriptionsFindMany: vi.fn(),
  cleanupCreateMany: vi.fn(),
  jornadaDeleteMany: vi.fn(),
  rondaPlayoffDeleteMany: vi.fn(),
  tablaPosicionDeleteMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    liga: { findFirst: mocks.ligaFindFirst },
    division: { findFirst: mocks.divisionFindFirst },
    estadoLiga: { findFirstOrThrow: mocks.estadoLigaFindFirstOrThrow },
  },
}));

vi.mock('./repository', () => ({
  divisionRepository: {
    create: mocks.create,
    update: mocks.update,
    delete: mocks.delete,
  },
}));

import { divisionService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

const createData = {
  nombre: 'Primera',
  maxEquipos: 12,
  ligaId: 'liga-1',
  categoriaId: 'categoria-1',
  tipoId: 'tipo-1',
  tipoCompetenciaId: 'competencia-1',
};

const tx = {
  divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany },
  oneSignalTagCleanupJob: { createMany: mocks.cleanupCreateMany },
  jornada: { deleteMany: mocks.jornadaDeleteMany },
  rondaPlayoff: { deleteMany: mocks.rondaPlayoffDeleteMany },
  tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
};

describe('consultas privadas optimizadas de división', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1' });
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.subscriptionsFindMany.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: 'division-1' });
    mocks.update.mockResolvedValue({ id: 'division-1' });
  });

  it.each([
    ['propietario', owner, { id: 'liga-1', userId: owner.id }],
    ['administrador', admin, { id: 'liga-1' }],
  ])('autoriza la liga con una proyección mínima para %s', async (_label, actor, where) => {
    await divisionService.create({ ...createData, estadoLigaId: 'estado-1' }, actor);

    expect(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({ where, select: { id: true } });
    expect(mocks.estadoLigaFindFirstOrThrow).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('selecciona únicamente el id de la configuración Borrador cuando es necesaria', async () => {
    mocks.estadoLigaFindFirstOrThrow.mockResolvedValue({ id: 'borrador-1' });

    await divisionService.create(createData, owner);

    expect(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledWith({
      where: { nombre: 'Borrador' },
      select: { id: true },
    });
    expect(mocks.create).toHaveBeenCalledWith({ ...createData, estadoLigaId: 'borrador-1' });
  });

  it.each([
    ['propietario', owner, { id: 'division-1', liga: { userId: owner.id } }],
    ['administrador', admin, { id: 'division-1' }],
  ])('autoriza una actualización en una consulta estrecha para %s', async (_label, actor, where) => {
    await divisionService.update('division-1', { nombre: 'Nueva' }, actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { id: true } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('conserva el 404 y evita escrituras cuando la división no es administrable', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.update('division-1', { nombre: 'Nueva' }, owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('ejecuta las tres limpiezas del reset en una transacción después de una sola autorización', async () => {
    await divisionService.resetDivision('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: { id: true },
    });
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1' } });
    expect(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
  });

  it('propaga un fallo del reset y no ejecuta escrituras posteriores fuera de la transacción', async () => {
    const failure = new Error('playoff cleanup failed');
    mocks.rondaPlayoffDeleteMany.mockRejectedValue(failure);

    await expect(divisionService.resetDivision('division-1', owner)).rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).not.toHaveBeenCalled();
  });

  it('no abre una transacción de reset si falla la autorización', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.resetDivision('division-1', owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('crea los jobs de OneSignal en lote y elimina la división en la misma transacción', async () => {
    mocks.subscriptionsFindMany.mockResolvedValue([
      { oneSignalId: 'onesignal-1' },
      { oneSignalId: 'onesignal-2' },
    ]);

    await divisionService.delete('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.subscriptionsFindMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1' },
      select: { oneSignalId: true },
    });
    expect(mocks.cleanupCreateMany).toHaveBeenCalledOnce();
    expect(mocks.cleanupCreateMany).toHaveBeenCalledWith({
      data: [
        { oneSignalId: 'onesignal-1', tag: 'division_division-1' },
        { oneSignalId: 'onesignal-2', tag: 'division_division-1' },
      ],
      skipDuplicates: true,
    });
    expect(mocks.delete).toHaveBeenCalledWith('division-1', tx);
  });

  it('no elimina la división cuando falla la creación del lote de cleanup', async () => {
    mocks.subscriptionsFindMany.mockResolvedValue([{ oneSignalId: 'onesignal-1' }]);
    const failure = new Error('cleanup queue failed');
    mocks.cleanupCreateMany.mockRejectedValue(failure);

    await expect(divisionService.delete('division-1', owner)).rejects.toBe(failure);

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('omite createMany si no hay suscriptores y conserva el presupuesto de consultas', async () => {
    await divisionService.delete('division-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.subscriptionsFindMany).toHaveBeenCalledOnce();
    expect(mocks.cleanupCreateMany).not.toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('no abre una transacción de eliminación si falla la autorización', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionService.delete('division-1', owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Division no encontrado',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.subscriptionsFindMany).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

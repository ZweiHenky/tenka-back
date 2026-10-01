import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByDivision: vi.fn(),
  findByEquipo: vi.fn(),
  create: vi.fn(),
  updateSaldoPendiente: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  divisionFindFirst: vi.fn(),
  divisionEquipoCount: vi.fn(),
  tablaPosicionDeleteMany: vi.fn(),
}));

vi.mock('./repository', () => ({
  divisionEquipoRepository: {
    findByDivision: mocks.findByDivision,
    findByEquipo: mocks.findByEquipo,
    create: mocks.create,
    updateSaldoPendiente: mocks.updateSaldoPendiente,
    delete: mocks.delete,
  },
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    division: { findFirst: mocks.divisionFindFirst },
  },
}));

import { divisionEquipoService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const tx = {
  division: { findFirst: mocks.divisionFindFirst },
  divisionEquipo: { count: mocks.divisionEquipoCount },
  tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
};

describe('divisionEquipoService.findByDivision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
  });

  it('returns an empty list for a visible division without teams using one domain operation', async () => {
    mocks.findByDivision.mockResolvedValue([]);

    await expect(divisionEquipoService.findByDivision('division-1', owner)).resolves.toEqual([]);
    expect(mocks.findByDivision).toHaveBeenCalledTimes(1);
    expect(mocks.findByDivision).toHaveBeenCalledWith('division-1', owner);
  });

  it('returns 404 when the division is hidden or missing', async () => {
    mocks.findByDivision.mockResolvedValue(null);

    await expect(divisionEquipoService.findByDivision('division-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });
    expect(mocks.findByDivision).toHaveBeenCalledTimes(1);
  });
});

describe('divisionEquipoService query and saldo update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates equipo visibility and omission to one repository operation', async () => {
    mocks.findByEquipo.mockResolvedValue([{ divisionId: 'division-1', equipoId: 'equipo-1' }]);

    await expect(divisionEquipoService.findByEquipo('equipo-1', owner)).resolves.toEqual([
      { divisionId: 'division-1', equipoId: 'equipo-1' },
    ]);
    expect(mocks.findByEquipo).toHaveBeenCalledWith('equipo-1', owner);
  });

  it('returns the canonical saldo after an authorized update', async () => {
    mocks.updateSaldoPendiente.mockResolvedValue(true);

    await expect(divisionEquipoService.updateSaldoPendiente(
      'division-1', 'equipo-1', '10.50', owner,
    )).resolves.toEqual({ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '10.50' });
    expect(mocks.updateSaldoPendiente).toHaveBeenCalledWith(
      'division-1', 'equipo-1', '10.50', owner, tx,
    );
  });

  it.each([owner, admin])('uses the same 404 for missing pivots and unauthorized actors', async (actor) => {
    mocks.updateSaldoPendiente.mockResolvedValue(false);

    await expect(divisionEquipoService.updateSaldoPendiente(
      'division-1', 'equipo-1', '10.50', actor,
    )).rejects.toMatchObject({ statusCode: 404, message: 'Equipo de la división no encontrado' });
    expect(mocks.updateSaldoPendiente).toHaveBeenCalledOnce();
  });
});

describe('divisionEquipoService private management queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.divisionFindFirst.mockResolvedValue({ maxEquipos: 10 });
    mocks.divisionEquipoCount.mockResolvedValue(3);
    mocks.create.mockResolvedValue({ divisionId: 'division-1', equipoId: 'equipo-1' });
    mocks.delete.mockResolvedValue(undefined);
    mocks.tablaPosicionDeleteMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ['owner', owner, { id: 'division-1', liga: { userId: owner.id } }],
    ['admin', admin, { id: 'division-1' }],
  ])('loads only capacity and constrained authorization for %s creation', async (_label, actor, where) => {
    await divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { maxEquipos: true } });
    expect(mocks.divisionEquipoCount).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({ divisionId: 'division-1', equipoId: 'equipo-1' }, tx);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('keeps 404 behavior and stops before count/write for a foreign division', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
      .rejects.toMatchObject({ statusCode: 404, message: 'División no encontrado' });
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionEquipoCount).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('conserva el error de capacidad y no intenta crear la relación', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ maxEquipos: 3 });
    mocks.divisionEquipoCount.mockResolvedValue(3);

    await expect(divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
      .rejects.toMatchObject({
        statusCode: 422,
        message: 'La división ya alcanzó el máximo de 3 equipos',
      });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('elimina la relación y standings atómicamente después de autorización estrecha', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });

    await divisionEquipoService.delete('division-1', 'equipo-1', owner);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: { id: true },
    });
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledWith('division-1', 'equipo-1', tx);
    expect(mocks.tablaPosicionDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.delete.mock.invocationCallOrder[0]).toBeLessThan(mocks.tablaPosicionDeleteMany.mock.invocationCallOrder[0]);
  });

  it('detiene la limpieza de standings si falla el delete de la relación', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    const failure = new Error('pivot delete failed');
    mocks.delete.mockRejectedValue(failure);

    await expect(divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).not.toHaveBeenCalled();
  });

  it('propaga el fallo de standings para que la transacción revierta el delete', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    const failure = new Error('standings cleanup failed');
    mocks.tablaPosicionDeleteMany.mockRejectedValue(failure);

    await expect(divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toBe(failure);

    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('no abre una transacción de eliminación si falla la autorización', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('reintenta conflictos serializables y mantiene tres consultas por intento exitoso', async () => {
    mocks.transaction
      .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
      .mockImplementationOnce(async (callback) => callback(tx));

    await divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner);

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.divisionEquipoCount).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('limita a tres intentos los conflictos serializables', async () => {
    const failure = Object.assign(new Error('write conflict'), { code: 'P2034' });
    mocks.transaction.mockRejectedValue(failure);

    await expect(divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
      .rejects.toBe(failure);

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });

  it('no excede el presupuesto normal de una transacción y tres consultas de creación', async () => {
    await divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.divisionEquipoCount).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});

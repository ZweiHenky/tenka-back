import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../types/auth';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  preflight: vi.fn(),
  lock: vi.fn(),
  divisionReread: vi.fn(),
  pivotFindUnique: vi.fn(),
  pivotCreate: vi.fn(),
  pivotDelete: vi.fn(),
  equipoFindUnique: vi.fn(),
  partidoFindFirst: vi.fn(),
  partidoFindMany: vi.fn(),
  partidoUpdateMany: vi.fn(),
  divisionJugadorFindFirst: vi.fn(),
  participacionFindFirst: vi.fn(),
  anotacionFindFirst: vi.fn(),
  anotacionUpdateMany: vi.fn(),
  tablaFindUnique: vi.fn(),
  tablaUpdateMany: vi.fn(),
  campeonUpdateMany: vi.fn(),
  resourceGate: vi.fn(),
}));

vi.mock('./repository', () => ({
  divisionEquipoRepository: {
    findByDivision: vi.fn(),
    findByEquipo: vi.fn(),
    create: vi.fn(),
    updateSaldoPendiente: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    division: { findFirst: mocks.preflight },
  },
}));

vi.mock('../../utils/leagueScheduleLock', () => ({ acquireLeagueScheduleLock: mocks.lock }));
vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: mocks.resourceGate,
}));

import { divisionEquipoService } from './service';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const saldo = { toFixed: () => '17.25' };
const tx = {
  division: { findFirst: mocks.divisionReread },
  divisionEquipo: {
    findUnique: mocks.pivotFindUnique,
    create: mocks.pivotCreate,
    delete: mocks.pivotDelete,
  },
  equipo: { findUnique: mocks.equipoFindUnique },
  partido: {
    findFirst: mocks.partidoFindFirst,
    findMany: mocks.partidoFindMany,
    updateMany: mocks.partidoUpdateMany,
  },
  divisionJugador: { findFirst: mocks.divisionJugadorFindFirst },
  participacionPartido: { findFirst: mocks.participacionFindFirst },
  anotacionPartido: {
    findFirst: mocks.anotacionFindFirst,
    updateMany: mocks.anotacionUpdateMany,
  },
  tablaPosicion: { findUnique: mocks.tablaFindUnique, updateMany: mocks.tablaUpdateMany },
  divisionCampeon: { updateMany: mocks.campeonUpdateMany },
};

function setValidState() {
  mocks.preflight.mockResolvedValue({ ligaId: 'liga-1' });
  mocks.divisionReread.mockResolvedValue({ ligaId: 'liga-1' });
  mocks.pivotFindUnique
    .mockResolvedValueOnce({ saldoPendiente: saldo })
    .mockResolvedValueOnce(null);
  mocks.equipoFindUnique.mockResolvedValue({
    id: 'target-1', nombre: 'Tigres', logo: 'logo.png', userId: 'captain-2',
  });
  mocks.partidoFindFirst.mockResolvedValue(null);
  mocks.divisionJugadorFindFirst.mockResolvedValue(null);
  mocks.participacionFindFirst.mockResolvedValue(null);
  mocks.anotacionFindFirst.mockResolvedValue(null);
  mocks.tablaFindUnique.mockResolvedValue(null);
  mocks.partidoFindMany.mockResolvedValue([
    { id: 'local', equipoLocalId: 'source-1', equipoVisitanteId: 'other-1' },
    { id: 'visitor', equipoLocalId: 'other-2', equipoVisitanteId: 'source-1' },
    { id: 'self', equipoLocalId: 'source-1', equipoVisitanteId: 'source-1' },
  ]);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
}

describe('divisionEquipoService.reemplazo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setValidState();
  });

  it('locks before authoritative reads, preserves data, scopes writes, and deletes the source pivot last', async () => {
    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).resolves.toEqual({
      divisionId: 'division-1',
      equipoId: 'target-1',
      saldoPendiente: '17.25',
      equipo: { id: 'target-1', nombre: 'Tigres', logo: 'logo.png', userId: 'captain-2' },
      equipoReemplazadoId: 'source-1',
      partidosActualizados: 3,
    });

    const authorizationWhere = { id: 'division-1', liga: { userId: owner.id } };
    expect(mocks.preflight).toHaveBeenCalledWith({ where: authorizationWhere, select: { ligaId: true } });
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'liga-1');
    expect(mocks.divisionReread).toHaveBeenCalledWith({ where: authorizationWhere, select: { ligaId: true } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(mocks.resourceGate.mock.invocationCallOrder[0]);
    expect(mocks.resourceGate.mock.invocationCallOrder[0]).toBeLessThan(mocks.lock.mock.invocationCallOrder[0]);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.divisionReread.mock.invocationCallOrder[0]);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.pivotCreate.mock.invocationCallOrder[0]);
    expect(mocks.pivotCreate).toHaveBeenCalledWith({
      data: { divisionId: 'division-1', equipoId: 'target-1', saldoPendiente: saldo },
    });
    expect(mocks.anotacionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ partidoId: { in: ['local', 'visitor', 'self'] }, jugadorIdSnapshot: null }),
      data: { equipoId: 'target-1', equipoIdSnapshot: 'target-1', equipoNombre: 'Tigres' },
    }));
    expect(mocks.partidoUpdateMany).toHaveBeenCalledTimes(3);
    expect(mocks.partidoUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['self'] } },
      data: { equipoLocalId: 'target-1', equipoVisitanteId: 'target-1', version: { increment: 1 } },
    });
    expect(mocks.tablaUpdateMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', equipoId: 'source-1' }, data: { equipoId: 'target-1' },
    });
    expect(mocks.campeonUpdateMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', equipoId: 'source-1' },
      data: { equipoId: 'target-1', equipoNombre: 'Tigres', equipoLogo: 'logo.png' },
    });
    expect(mocks.pivotDelete).toHaveBeenCalledWith({
      where: { divisionId_equipoId: { divisionId: 'division-1', equipoId: 'source-1' } },
    });
    expect(mocks.pivotDelete.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.campeonUpdateMany.mock.invocationCallOrder[0]);
  });

  it('uses an admin-compatible constrained preflight and repeats authorization inside the lock', async () => {
    await divisionEquipoService.reemplazo('division-1', 'source-1', 'target-1', admin);

    expect(mocks.preflight).toHaveBeenCalledWith({ where: { id: 'division-1' }, select: { ligaId: true } });
    expect(mocks.divisionReread).toHaveBeenCalledWith({ where: { id: 'division-1' }, select: { ligaId: true } });
  });

  it('rejects equal ids before preflight', async () => {
    await expect(divisionEquipoService.reemplazo(
      'division-1', 'same', 'same', owner,
    )).rejects.toMatchObject({ statusCode: 422 });

    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not expose a foreign or missing division and starts no transaction', async () => {
    mocks.preflight.mockResolvedValue(null);

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 404, message: 'División no encontrado' });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rechecks authorization after locking and performs no domain writes if it changed', async () => {
    mocks.divisionReread.mockResolvedValue(null);

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 404, message: 'División no encontrado' });

    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.pivotFindUnique).not.toHaveBeenCalled();
    expect(mocks.pivotCreate).not.toHaveBeenCalled();
  });

  it('requires the source pivot', async () => {
    mocks.pivotFindUnique.mockReset().mockResolvedValue(null);

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 404, message: 'Equipo de la división no encontrado' });

    expect(mocks.equipoFindUnique).not.toHaveBeenCalled();
    expect(mocks.pivotCreate).not.toHaveBeenCalled();
  });

  it('requires the target global team without deleting either global team', async () => {
    mocks.equipoFindUnique.mockResolvedValue(null);

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 404, message: 'Equipo nuevo no encontrado' });

    expect(mocks.pivotCreate).not.toHaveBeenCalled();
    expect(tx.equipo).not.toHaveProperty('delete');
  });

  it.each([
    ['target pivot', () => mocks.pivotFindUnique.mockReset().mockResolvedValueOnce({ saldoPendiente: saldo }).mockResolvedValueOnce({ equipoId: 'target-1' })],
    ['target match', () => mocks.partidoFindFirst.mockResolvedValue({ id: 'match-1' })],
    ['source roster', () => mocks.divisionJugadorFindFirst.mockResolvedValue({ jugadorId: 'player-1' })],
    ['source participation', () => mocks.participacionFindFirst.mockResolvedValue({ id: 'participation-1' })],
    ['player scoring', () => mocks.anotacionFindFirst.mockResolvedValue({ id: 'goal-1' })],
    ['stale target standing', () => mocks.tablaFindUnique.mockResolvedValue({ id: 'standing-1' })],
  ])('blocks the %s guard before writes', async (_label, arrange) => {
    arrange();

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.pivotCreate).not.toHaveBeenCalled();
    expect(mocks.partidoUpdateMany).not.toHaveBeenCalled();
    expect(mocks.pivotDelete).not.toHaveBeenCalled();
  });

  it('retries the whole locked transaction on P2034 and maps exhaustion to 409', async () => {
    const serializationFailure = Object.assign(new Error('serialization failure'), { code: 'P2034' });
    mocks.transaction.mockRejectedValue(serializationFailure);

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('vuelve a intentarlo') });

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });

  it('maps a uniqueness race to a clear 409', async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error('unique race'), { code: 'P2002' }));

    await expect(divisionEquipoService.reemplazo(
      'division-1', 'source-1', 'target-1', owner,
    )).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('cambiaron') });

    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});

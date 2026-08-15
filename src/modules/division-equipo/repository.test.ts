import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  divisionFindFirst: vi.fn(),
  divisionEquipoFindMany: vi.fn(),
  divisionEquipoCreate: vi.fn(),
  divisionEquipoUpdateMany: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
    divisionEquipo: {
      findMany: mocks.divisionEquipoFindMany,
      create: mocks.divisionEquipoCreate,
      updateMany: mocks.divisionEquipoUpdateMany,
    },
  },
}));

import { divisionEquipoRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

describe('divisionEquipoRepository.findByDivision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }, false, false],
    [owner, { OR: [
      { estadoLiga: { nombre: { not: 'Borrador' } } },
      { liga: { userId: owner.id } },
    ] }, true, true],
    [admin, {}, true, false],
  ])('retrieves pivots with the visibility filter for %#', async (actor, visibility, includeSaldo, includeOwner) => {
    const equipo = { id: 'equipo-1', nombre: 'Leones', logo: null, userId: owner.id };
    const equipos = [{ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '12.30' }, equipo }];
    mocks.divisionFindFirst.mockResolvedValue({ equipos, ...(includeOwner ? { liga: { userId: owner.id } } : {}) });

    await expect(divisionEquipoRepository.findByDivision('division-1', actor)).resolves.toEqual([{
      divisionId: 'division-1',
      equipoId: 'equipo-1',
      equipo,
      ...(includeSaldo ? { saldoPendiente: '12.30' } : {}),
    }]);
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', ...visibility },
      select: {
        equipos: { orderBy: { equipo: { nombre: 'asc' } }, select: {
          divisionId: true,
          equipoId: true,
          ...(includeSaldo ? { saldoPendiente: true } : {}),
          equipo: { select: { id: true, nombre: true, logo: true, userId: true } },
        } },
        ...(includeOwner ? { liga: { select: { userId: true } } } : {}),
      },
    });
  });

  it('distinguishes a visible division without teams from a hidden or missing division', async () => {
    mocks.divisionFindFirst.mockResolvedValueOnce({ equipos: [] }).mockResolvedValueOnce(null);

    await expect(divisionEquipoRepository.findByDivision('visible')).resolves.toEqual([]);
    await expect(divisionEquipoRepository.findByDivision('hidden-or-missing')).resolves.toBeNull();
  });

  it('omits saldo for an authenticated nonowner without a second query', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      liga: { userId: 'another-owner' },
      equipos: [{ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '8.00' }, equipo: { id: 'equipo-1', nombre: 'Leones', logo: null, userId: owner.id } }],
    });

    await expect(divisionEquipoRepository.findByDivision('division-1', owner)).resolves.toEqual([
      { divisionId: 'division-1', equipoId: 'equipo-1', equipo: { id: 'equipo-1', nombre: 'Leones', logo: null, userId: owner.id } },
    ]);
    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
  });
});

describe('divisionEquipoRepository saldo boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explicitly selects no saldo when listing by equipo', async () => {
    mocks.divisionEquipoFindMany.mockResolvedValue([]);

    await divisionEquipoRepository.findByEquipo('equipo-1', owner);

    expect(mocks.divisionEquipoFindMany).toHaveBeenCalledWith({
      where: { equipoId: 'equipo-1', division: { OR: [
        { estadoLiga: { nombre: { not: 'Borrador' } } },
        { liga: { userId: owner.id } },
      ] } },
      select: {
        divisionId: true,
        equipoId: true,
        division: { include: {
          liga: { select: { id: true, nombre: true, logo: true } },
          categoria: { select: { id: true, nombre: true } },
          estadoLiga: { select: { id: true, nombre: true } },
        } },
      },
    });
  });

  it('returns the default create saldo as a canonical string', async () => {
    mocks.divisionEquipoCreate.mockResolvedValue({
      divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '0.00' },
    });

    await expect(divisionEquipoRepository.create({ divisionId: 'division-1', equipoId: 'equipo-1' }))
      .resolves.toEqual({ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '0.00' });
    expect(mocks.divisionEquipoCreate).toHaveBeenCalledWith({
      data: { divisionId: 'division-1', equipoId: 'equipo-1' },
    });
  });

  it.each([
    [owner, { division: { liga: { userId: owner.id } } }],
    [admin, {}],
  ])('constrains saldo updates for actor %#', async (actor, authorization) => {
    mocks.divisionEquipoUpdateMany.mockResolvedValue({ count: 1 });

    await expect(divisionEquipoRepository.updateSaldoPendiente(
      'division-1', 'equipo-1', '25.50', actor,
    )).resolves.toBe(true);
    expect(mocks.divisionEquipoUpdateMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', equipoId: 'equipo-1', ...authorization },
      data: { saldoPendiente: '25.50' },
    });
  });

  it('reports a hidden or missing pivot without revealing which condition failed', async () => {
    mocks.divisionEquipoUpdateMany.mockResolvedValue({ count: 0 });

    await expect(divisionEquipoRepository.updateSaldoPendiente(
      'division-1', 'equipo-1', '1.00', owner,
    )).resolves.toBe(false);
    expect(mocks.divisionEquipoUpdateMany).toHaveBeenCalledOnce();
  });
});

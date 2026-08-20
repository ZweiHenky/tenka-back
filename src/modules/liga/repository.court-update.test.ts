import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  courtUpdate: vi.fn(),
  courtCreate: vi.fn(),
  refereeDeleteMany: vi.fn(),
  refereeCreateMany: vi.fn(),
  leagueUpdate: vi.fn(),
  divisionUpdateMany: vi.fn(),
  courtScheduleDeleteMany: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { ligaRepository } from './repository';

describe('actualizacion atomica de canchas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation) => operation({
      ligaCancha: { update: mocks.courtUpdate, create: mocks.courtCreate },
      ligaArbitro: { deleteMany: mocks.refereeDeleteMany, createMany: mocks.refereeCreateMany },
      liga: { update: mocks.leagueUpdate },
      division: { updateMany: mocks.divisionUpdateMany },
      divisionCanchaHorario: { deleteMany: mocks.courtScheduleDeleteMany },
    }));
    mocks.leagueUpdate.mockResolvedValue({ id: 'liga-1' });
  });

  it('limpia las canchas fijas dentro de la transacción al desactivar el modo múltiple', async () => {
    await ligaRepository.update('liga-1', { multiplesCanchas: false }, undefined, undefined, true);

    expect(mocks.divisionUpdateMany).toHaveBeenCalledWith({
      where: { ligaId: 'liga-1' },
      data: { canchaUnicaId: null },
    });
    // Per-court schedules make no sense once the league runs a single court.
    expect(mocks.courtScheduleDeleteMany).toHaveBeenCalledWith({
      where: { division: { ligaId: 'liga-1' } },
    });
    expect(mocks.leagueUpdate).toHaveBeenCalledOnce();
  });

  it('actualiza ids estables, crea nuevas y cambia la liga dentro de una transaccion', async () => {
    await ligaRepository.update('liga-1', { multiplesCanchas: true }, [
      {
        id: 'court-1',
        nombre: 'Central',
        nombreNormalizado: 'central',
        nombreNormalizadoAnterior: 'principal',
        activa: true,
      },
      { nombre: 'Norte', nombreNormalizado: 'norte', activa: true },
    ]);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.courtUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'court-1' },
      data: { nombreNormalizado: '__liga_cancha_tmp_court-1' },
    });
    expect(mocks.courtUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'court-1' },
      data: { nombre: 'Central', nombreNormalizado: 'central', activa: true },
    });
    expect(mocks.courtCreate).toHaveBeenCalledWith({
      data: { ligaId: 'liga-1', nombre: 'Norte', nombreNormalizado: 'norte', activa: true },
    });
    expect(mocks.leagueUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'liga-1' },
      data: { multiplesCanchas: true },
    }));
  });
});

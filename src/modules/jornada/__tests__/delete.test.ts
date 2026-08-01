import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    rondaPlayoff: { findUnique: vi.fn(), findFirst: vi.fn() },
    partido: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    partidoRefereeAccess: { deleteMany: vi.fn() },
    jornada: { delete: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});

vi.mock('../../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock('../repository', () => ({
  jornadaRepository: {
    findDeleteContext: vi.fn(),
  },
}));

vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vi.mock('../../tabla-posicion/service', () => ({
  tablaPosicionService: { recalcular: vi.fn() },
}));
vi.mock('../../notification/service', () => ({
  notificationService: { notifyJornadaGenerated: vi.fn() },
}));

import { jornadaService } from '../service';
import { jornadaRepository } from '../repository';
import { tablaPosicionService } from '../../tabla-posicion/service';
import type { AuthenticatedUser } from '../../../types/auth';

const owner: AuthenticatedUser = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };

const semifinales = [
  {
    id: 'semi-1', rondaPlayoffId: 'ronda-semi', llave: 1, estado: 'FINALIZADO',
    golesLocal: 2, golesVisitante: 1, penalesLocal: null, penalesVisitante: null,
  },
  {
    id: 'semi-2', rondaPlayoffId: 'ronda-semi', llave: 2, estado: 'FINALIZADO',
    golesLocal: 1, golesVisitante: 1, penalesLocal: 4, penalesVisitante: 3,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  (jornadaRepository.findDeleteContext as ReturnType<typeof vi.fn>).mockResolvedValue({
    divisionId: 'div-1',
    latestJornadaId: 'j-semis',
    hasFinalizados: true,
    playoffPartidos: semifinales,
  });
  mocks.tx.rondaPlayoff.findUnique.mockResolvedValue({ divisionId: 'div-1', orden: 1 });
  mocks.tx.rondaPlayoff.findFirst.mockResolvedValue({ id: 'ronda-final' });
  mocks.tx.partido.findMany.mockResolvedValue([{ id: 'final-1', jornadaId: null }]);
});

describe('jornadaService.delete playoff rollback', () => {
  it('restores semifinales and deletes the derived final', async () => {
    await jornadaService.delete('j-semis', owner);

    expect(mocks.tx.partido.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['final-1'] } } });
    expect(mocks.tx.partidoRefereeAccess.deleteMany).toHaveBeenCalledWith({
      where: { partidoId: { in: ['semi-1', 'semi-2'] } },
    });
    expect(mocks.tx.partido.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['semi-1', 'semi-2'] } },
      data: {
        estado: 'PROGRAMADO',
        golesLocal: 0,
        golesVisitante: 0,
        penalesLocal: null,
        penalesVisitante: null,
        fecha: null,
        fechaFin: null,
        canchaId: null,
        jornadaId: null,
      },
    });
    expect(mocks.tx.jornada.delete).toHaveBeenCalledWith({ where: { id: 'j-semis' } });
    expect(tablaPosicionService.recalcular).toHaveBeenCalledWith('div-1');
    expect(jornadaRepository.findDeleteContext).toHaveBeenCalledOnce();
  });

  it('rejects deletion when the derived match belongs to another jornada', async () => {
    mocks.tx.partido.findMany.mockResolvedValue([{ id: 'final-1', jornadaId: 'j-final' }]);

    await expect(jornadaService.delete('j-semis', owner)).rejects.toThrow('siguiente fase ya fue programada');
    expect(mocks.tx.partido.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.partido.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.jornada.delete).not.toHaveBeenCalled();
  });

  it('restores a final without trying to delete a later phase', async () => {
    (jornadaRepository.findDeleteContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      divisionId: 'div-1',
      latestJornadaId: 'j-final',
      hasFinalizados: true,
      playoffPartidos: [{ ...semifinales[0], id: 'final-1', rondaPlayoffId: 'ronda-final', llave: 1 }],
    });
    mocks.tx.rondaPlayoff.findUnique.mockResolvedValue({ divisionId: 'div-1', orden: 2 });
    mocks.tx.rondaPlayoff.findFirst.mockResolvedValue(null);

    await jornadaService.delete('j-final', owner);

    expect(mocks.tx.partido.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['final-1'] } },
    }));
  });

  it('returns 404 without opening a transaction when the jornada is not manageable', async () => {
    (jornadaRepository.findDeleteContext as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(jornadaService.delete('hidden', owner)).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('enforces the latest-jornada rule from the narrow context', async () => {
    (jornadaRepository.findDeleteContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      divisionId: 'div-1',
      latestJornadaId: 'j-newer',
      hasFinalizados: false,
      playoffPartidos: [],
    });

    await expect(jornadaService.delete('j-old', owner)).rejects.toThrow('última jornada');

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

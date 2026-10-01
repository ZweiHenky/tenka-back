import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  partidoFindUnique: vi.fn(),
  transaction: vi.fn(),
  jornadaFindUnique: vi.fn(),
  observeResourceAccess: vi.fn(),
  acquireLeagueScheduleLock: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    partido: { findUnique: mocks.partidoFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: mocks.observeResourceAccess,
}));

vi.mock('../../utils/leagueScheduleLock', () => ({
  acquireLeagueScheduleLock: mocks.acquireLeagueScheduleLock,
}));

import { jornadaPartidoCreationService } from './jornadaCreation';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const input = {
  equipoLocalId: 'team-1',
  equipoVisitanteId: 'team-2',
  tipoPartido: 'REGULAR' as const,
  fecha: '2099-01-01',
  horaInicio: '18:00',
  horaFin: '19:00',
  canchaId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.partidoFindUnique.mockResolvedValue(null);
  mocks.jornadaFindUnique.mockResolvedValue({
    division: {
      id: 'division-1',
      ligaId: 'league-1',
      estadoLiga: { codigo: 'EN_CURSO' },
      liga: { userId: owner.id, timeZone: 'UTC' },
    },
  });
  mocks.transaction.mockImplementation((callback) => callback({
    jornada: { findUnique: mocks.jornadaFindUnique },
  }));
});

describe('jornadaPartidoCreationService.create billing gate ordering', () => {
  it('authorizes, runs the transactional billing gate, and only then acquires the schedule lock', async () => {
    const events: string[] = [];
    mocks.observeResourceAccess.mockImplementation(async () => { events.push('billing'); });
    mocks.acquireLeagueScheduleLock.mockImplementation(async () => {
      events.push('schedule-lock');
      throw new Error('stop after lock');
    });

    await expect(jornadaPartidoCreationService.create('jornada-1', input, 'creation-key', owner))
      .rejects.toThrow('stop after lock');

    expect(events).toEqual(['billing', 'schedule-lock']);
    expect(mocks.observeResourceAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operation: 'match.create-in-round',
      divisionId: 'division-1',
    }));
  });

  it('does not run billing or acquire the lock when legacy authorization rejects the actor', async () => {
    mocks.jornadaFindUnique.mockResolvedValue({
      division: {
        id: 'division-1',
        ligaId: 'league-1',
        estadoLiga: { codigo: 'EN_CURSO' },
        liga: { userId: 'another-owner', timeZone: 'UTC' },
      },
    });

    await expect(jornadaPartidoCreationService.create('jornada-1', input, 'creation-key', owner))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.observeResourceAccess).not.toHaveBeenCalled();
    expect(mocks.acquireLeagueScheduleLock).not.toHaveBeenCalled();
  });
});

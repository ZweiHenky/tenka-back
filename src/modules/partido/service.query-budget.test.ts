import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import {
  owner,
  partido,
  partidoRepository,
  partidoService,
  prisma,
  resetServiceTestHarness,
} from './service.test-harness';

beforeEach(resetServiceTestHarness);

describe('partidoService private query budgets', () => {
  it('updates a score with only the authorization-context read and update write', async () => {
    const updated = { ...partido, golesLocal: 2 };
    vi.mocked(partidoRepository.update).mockResolvedValue(updated as any);

    await expect(partidoService.update('partido-1', { golesLocal: 2 }, owner)).resolves.toEqual(updated);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
    expect(partidoRepository.update).toHaveBeenCalledOnce();
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.findVisibleById).not.toHaveBeenCalled();
  });

  it('deletes with only the authorization-context read and delete write', async () => {
    await partidoService.delete('partido-1', owner);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
    expect(partidoRepository.delete).toHaveBeenCalledOnce();
    expect(partidoRepository.delete).toHaveBeenCalledWith('partido-1');
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.findVisibleById).not.toHaveBeenCalled();
  });

  it('uses one conflict read and one transactional schedule snapshot for a replacement', async () => {
    await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledOnce();
    expect(prisma.divisionEquipo.count).toHaveBeenCalledOnce();
    expect(prisma.partido.findMany).toHaveBeenCalledOnce();
    expect(prisma.partido.findFirst).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.jornada.findMany).toHaveBeenCalledOnce();
    expect(prisma.jornada.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId: 'division-1' },
    }));
    expect(prisma.jornada.findUnique).not.toHaveBeenCalled();
    expect(prisma.partido.update).toHaveBeenCalledTimes(2);
  });
});

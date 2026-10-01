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
  it('updates a jornada score with preflight and transactional authorization reads', async () => {
    const updated = { ...partido, golesLocal: 2 };
    vi.mocked(partidoRepository.update).mockResolvedValue(updated as any);

    await expect(partidoService.update('partido-1', { golesLocal: 2 }, owner)).resolves.toEqual(updated);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', prisma);
    expect(partidoRepository.update).toHaveBeenCalledOnce();
    expect(partidoRepository.update).toHaveBeenCalledWith('partido-1', { golesLocal: 2 }, prisma);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.findVisibleById).not.toHaveBeenCalled();
  });

  it('deletes a jornada partido with preflight and transactional authorization reads', async () => {
    await partidoService.delete('partido-1', owner);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', prisma);
    expect(partidoRepository.delete).toHaveBeenCalledOnce();
    expect(partidoRepository.delete).toHaveBeenCalledWith('partido-1', prisma);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.findVisibleById).not.toHaveBeenCalled();
  });

  it('keeps all replacement reads except authorization preflight inside one transaction', async () => {
    await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(1, 'partido-1');
    expect(partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', prisma);
    expect(prisma.divisionEquipo.count).toHaveBeenCalledOnce();
    expect(prisma.partido.findMany).not.toHaveBeenCalled();
    expect(prisma.partido.findFirst).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.jornada.findMany).toHaveBeenCalledOnce();
    expect(prisma.jornada.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId: 'division-1' },
    }));
    expect(prisma.jornada.findUnique).not.toHaveBeenCalled();
    const raw = vi.mocked(prisma.$executeRawUnsafe).mock;
    const scheduleLockIndexes = raw.calls
      .map(([, lockKey], index) => lockKey === 'liga-1' ? index : -1)
      .filter((index) => index >= 0);
    expect(scheduleLockIndexes).toHaveLength(1);
    expect(raw.invocationCallOrder[scheduleLockIndexes[0]])
      .toBeLessThan(vi.mocked(partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1]);
    expect(prisma.partido.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.partido.findUnique).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
});

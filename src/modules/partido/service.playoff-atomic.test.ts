import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import { rondaPlayoffService } from '../ronda-playoff/service';
import {
  context,
  owner,
  partido,
  partidoRepository,
  partidoService,
  prisma,
  resetServiceTestHarness,
} from './service.test-harness';

const playoffContext = {
  ...context,
  jornadaId: null,
  rondaPlayoffId: 'round-1',
  tipoPartido: 'ELIMINATORIA',
};

beforeEach(() => {
  resetServiceTestHarness();
  vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue(playoffContext);
  vi.mocked(rondaPlayoffService.syncAdvancement).mockResolvedValue(undefined);
});

describe('partidoService atomic playoff orchestration', () => {
  it('updates a playoff result and synchronizes advancement in the same locked transaction', async () => {
    const updated = { ...partido, ...playoffContext, estado: 'FINALIZADO', golesLocal: 2 } as any;
    vi.mocked(partidoRepository.update).mockResolvedValue(updated);

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 2 }, owner)).resolves.toBe(updated);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(partidoRepository.update).toHaveBeenCalledWith('partido-1', { estado: 'FINALIZADO', golesLocal: 2, version: { increment: 1 } }, prisma);
    expect(rondaPlayoffService.syncAdvancement).toHaveBeenCalledWith(prisma, 'round-1');
    expect(rondaPlayoffService.advanceWinners).not.toHaveBeenCalled();
  });

  it('does not commit a playoff result when advancement synchronization fails', async () => {
    const events: string[] = [];
    vi.mocked(partidoRepository.update).mockImplementation(async () => {
      events.push('update');
      return { ...partido, ...playoffContext, estado: 'FINALIZADO', golesLocal: 1 } as any;
    });
    vi.mocked(rondaPlayoffService.syncAdvancement).mockImplementation(async () => {
      events.push('sync');
      throw new Error('injected advancement failure');
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      events.push('begin');
      const result = await callback(prisma);
      events.push('commit');
      return result;
    });

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, owner))
      .rejects.toThrow('injected advancement failure');
    expect(events).toEqual(['begin', 'update', 'sync']);
  });

  it('deletes a playoff match and reverses its advancement before commit', async () => {
    const deleted = { ...partido, ...playoffContext } as any;
    vi.mocked(partidoRepository.delete).mockResolvedValue(deleted);

    await expect(partidoService.delete('partido-1', owner)).resolves.toBe(deleted);

    expect(partidoRepository.delete).toHaveBeenCalledWith('partido-1', prisma);
    expect(rondaPlayoffService.syncAdvancement).toHaveBeenCalledWith(prisma, 'round-1');
    expect(vi.mocked(partidoRepository.delete).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(rondaPlayoffService.syncAdvancement).mock.invocationCallOrder[0]);
  });

  it('does not commit a playoff delete when advancement reversal is rejected', async () => {
    const events: string[] = [];
    vi.mocked(partidoRepository.delete).mockImplementation(async () => {
      events.push('delete');
      return { ...partido, ...playoffContext } as any;
    });
    vi.mocked(rondaPlayoffService.syncAdvancement).mockImplementation(async () => {
      events.push('sync');
      throw new Error('protected derived match');
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      events.push('begin');
      const result = await callback(prisma);
      events.push('commit');
      return result;
    });

    await expect(partidoService.delete('partido-1', owner)).rejects.toThrow('protected derived match');
    expect(events).toEqual(['begin', 'delete', 'sync']);
  });
});

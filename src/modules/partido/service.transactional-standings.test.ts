import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

const resultWriterMocks = vi.hoisted(() => ({ gateResultWriteInTransaction: vi.fn(), writeResultInTransaction: vi.fn() }));
vi.mock('./resultWriter', () => ({
  gateResultWriteInTransaction: resultWriterMocks.gateResultWriteInTransaction,
  getResultContext: vi.fn(),
  writeResultInTransaction: resultWriterMocks.writeResultInTransaction,
}));

const billingMocks = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: billingMocks.observe,
}));

import {
  context,
  owner,
  partido,
  partidoRepository,
  partidoService,
  prisma,
  resetServiceTestHarness,
  tablaPosicionService,
} from './service.test-harness';

beforeEach(() => {
  resetServiceTestHarness();
  billingMocks.observe.mockReset().mockResolvedValue(undefined);
  resultWriterMocks.gateResultWriteInTransaction.mockReset().mockResolvedValue(undefined);
  resultWriterMocks.writeResultInTransaction.mockReset().mockResolvedValue(partido);
});

describe('partidoService transactional standings orchestration', () => {
  it('uses ReadCommitted and reauthorizes after the owner result lock', async () => {
    await partidoService.updateResult('partido-1', {
      expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [],
    }, owner);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    expect(vi.mocked(partidoRepository.findAuthorizationContext).mock.invocationCallOrder[0])
      .toBeLessThan(resultWriterMocks.gateResultWriteInTransaction.mock.invocationCallOrder[0]);
    expect(resultWriterMocks.gateResultWriteInTransaction).toHaveBeenCalledWith(prisma, 'division-1', owner);
    expect(resultWriterMocks.gateResultWriteInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.$executeRawUnsafe).mock.invocationCallOrder[0]);
    expect(vi.mocked(prisma.$executeRawUnsafe).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1]);
    expect(vi.mocked(partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1])
      .toBeLessThan(resultWriterMocks.writeResultInTransaction.mock.invocationCallOrder[0]);
  });

  it('rejects an owner result when post-lock ownership changed', async () => {
    vi.mocked(partidoRepository.findAuthorizationContext)
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, ligaUserId: 'other-owner' });

    await expect(partidoService.updateResult('partido-1', {
      expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [],
    }, owner)).rejects.toMatchObject({ statusCode: 404 });

    expect(resultWriterMocks.writeResultInTransaction).not.toHaveBeenCalled();
  });

  it('uses the same Serializable transaction for lock, reread, result update, and standings', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      jornada: { findUnique: vi.fn().mockResolvedValue({ divisionId: 'division-1' }) },
    } as any;
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(tx));
    vi.mocked(partidoRepository.update).mockResolvedValue({ ...partido, estado: 'FINALIZADO', golesLocal: 2 } as any);

    await partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 2 }, owner);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'liga-1');
    expect(billingMocks.observe).toHaveBeenCalledTimes(2);
    expect(billingMocks.observe.mock.invocationCallOrder[0])
      .toBeLessThan(tx.$executeRawUnsafe.mock.invocationCallOrder[0]);
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(billingMocks.observe.mock.invocationCallOrder[1]);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', tx);
    expect(partidoRepository.update).toHaveBeenCalledWith('partido-1', { estado: 'FINALIZADO', golesLocal: 2, version: { increment: 1 } }, tx);
    expect(tablaPosicionService.recalcular).toHaveBeenCalledWith('division-1', tx);
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(partidoRepository.update).mock.invocationCallOrder[0]);
    expect(vi.mocked(partidoRepository.update).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tablaPosicionService.recalcular).mock.invocationCallOrder[0]);
  });

  it('retries the complete result operation up to three times on P2034', async () => {
    const serializationFailure = Object.assign(new Error('serialization failure'), { code: 'P2034' });
    vi.mocked(partidoRepository.update).mockResolvedValue({ ...partido, estado: 'FINALIZADO' } as any);
    vi.mocked(tablaPosicionService.recalcular)
      .mockRejectedValueOnce(serializationFailure)
      .mockRejectedValueOnce(serializationFailure)
      .mockResolvedValueOnce(undefined);

    await partidoService.update('partido-1', { estado: 'FINALIZADO' }, owner);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(4);
    expect(partidoRepository.update).toHaveBeenCalledTimes(3);
    expect(tablaPosicionService.recalcular).toHaveBeenCalledTimes(3);
  });

  it('stops after three failed serialization attempts', async () => {
    const serializationFailure = Object.assign(new Error('serialization failure'), { code: 'P2034' });
    vi.mocked(partidoRepository.update).mockResolvedValue({ ...partido, estado: 'FINALIZADO' } as any);
    vi.mocked(tablaPosicionService.recalcular).mockRejectedValue(serializationFailure);

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO' }, owner))
      .rejects.toBe(serializationFailure);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(partidoRepository.update).toHaveBeenCalledTimes(3);
    expect(tablaPosicionService.recalcular).toHaveBeenCalledTimes(3);
  });

  it('does not reach transaction commit when standings recalculation fails', async () => {
    const events: string[] = [];
    vi.mocked(partidoRepository.update).mockImplementation(async () => {
      events.push('update');
      return { ...partido, estado: 'FINALIZADO' } as any;
    });
    vi.mocked(tablaPosicionService.recalcular).mockImplementation(async () => {
      events.push('recalculate');
      throw new Error('injected standings failure');
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      events.push('begin');
      const result = await callback(prisma);
      events.push('commit');
      return result;
    });

    await expect(partidoService.update('partido-1', { estado: 'FINALIZADO' }, owner))
      .rejects.toThrow('injected standings failure');

    expect(events).toEqual(['begin', 'update', 'recalculate']);
  });

  it('returns the exposed deleted partido and recalculates before the same transaction commits', async () => {
    const deleted = { ...partido, estado: 'FINALIZADO', arbitros: [{ id: 'ref-1', nombre: 'Ref' }] } as any;
    vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue({ ...context, estado: 'FINALIZADO' });
    vi.mocked(partidoRepository.delete).mockResolvedValue(deleted);

    await expect(partidoService.delete('partido-1', owner)).resolves.toBe(deleted);

    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
    expect(partidoRepository.delete).toHaveBeenCalledWith('partido-1', prisma);
    expect(tablaPosicionService.recalcular).toHaveBeenCalledWith('division-1', prisma);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(billingMocks.observe).toHaveBeenCalledTimes(2);
    expect(billingMocks.observe.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.$executeRawUnsafe).mock.invocationCallOrder[0]);
    expect(vi.mocked(partidoRepository.delete).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tablaPosicionService.recalcular).mock.invocationCallOrder[0]);
  });

  it('does not commit a delete when standings recalculation fails', async () => {
    const events: string[] = [];
    vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue({ ...context, estado: 'FINALIZADO' });
    vi.mocked(partidoRepository.delete).mockImplementation(async () => {
      events.push('delete');
      return partido as any;
    });
    vi.mocked(tablaPosicionService.recalcular).mockImplementation(async () => {
      events.push('recalculate');
      throw new Error('injected standings failure');
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      events.push('begin');
      const result = await callback(prisma);
      events.push('commit');
      return result;
    });

    await expect(partidoService.delete('partido-1', owner))
      .rejects.toThrow('injected standings failure');

    expect(events).toEqual(['begin', 'delete', 'recalculate']);
  });
});

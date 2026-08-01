import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import {
  admin,
  other,
  owner,
  partido,
  partidoRepository,
  partidoService,
  prisma,
  resetServiceTestHarness,
} from './service.test-harness';

beforeEach(resetServiceTestHarness);

describe('partidoService public collections', () => {
  it('delegates the visible list to one repository operation with the actor', async () => {
    await expect(partidoService.list(owner)).resolves.toEqual([partido]);

    expect(partidoRepository.findAllVisible).toHaveBeenCalledOnce();
    expect(partidoRepository.findAllVisible).toHaveBeenCalledWith(owner);
    expect(prisma.partido.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['jornada', () => partidoService.findByJornada('parent-1'), partidoRepository.findVisibleByJornada, 'Jornada'],
    ['ronda playoff', () => partidoService.findByRondaPlayoff('parent-1'), partidoRepository.findVisibleByRondaPlayoff, 'Ronda playoff'],
  ] as const)('returns an empty collection for a visible empty %s and 404 for a hidden or missing parent', async (_label, invoke, repositoryMethod, resource) => {
    vi.mocked(repositoryMethod).mockResolvedValueOnce([]).mockResolvedValueOnce(null);

    await expect(invoke()).resolves.toEqual([]);
    await expect(invoke()).rejects.toMatchObject({ statusCode: 404, message: `${resource} no encontrado` });
    expect(repositoryMethod).toHaveBeenCalledTimes(2);
  });

  it('passes the optional-auth actor to both parent visibility queries', async () => {
    await partidoService.findByJornada('jornada-1', owner);
    await partidoService.findByRondaPlayoff('ronda-1', admin);

    expect(partidoRepository.findVisibleByJornada).toHaveBeenCalledWith('jornada-1', owner);
    expect(partidoRepository.findVisibleByRondaPlayoff).toHaveBeenCalledWith('ronda-1', admin);
  });
});

describe('partidoService.getById', () => {
  it('loads the visible detail in a single repository call', async () => {
    await expect(partidoService.getById('partido-1', owner)).resolves.toEqual(partido);

    expect(partidoRepository.findVisibleById).toHaveBeenCalledWith('partido-1', owner);
    expect(partidoRepository.findById).not.toHaveBeenCalled();
    expect(partidoRepository.findAuthorizationContext).not.toHaveBeenCalled();
  });

  it('hides missing or unauthorized matches as 404', async () => {
    vi.mocked(partidoRepository.findVisibleById).mockResolvedValue(null);

    await expect(partidoService.getById('partido-hidden', other)).rejects.toMatchObject({ statusCode: 404 });
  });
});

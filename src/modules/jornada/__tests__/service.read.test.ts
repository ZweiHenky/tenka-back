import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleById: vi.fn(),
  findVisibleByDivision: vi.fn(),
}));

vi.mock('../../../config/database', () => ({ prisma: { jornada: { findMany: vi.fn() } } }));
vi.mock('../repository', () => ({
  jornadaRepository: {
    findVisibleById: mocks.findVisibleById,
    findVisibleByDivision: mocks.findVisibleByDivision,
  },
}));
vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vi.mock('../../notification/service', () => ({ notificationService: {} }));

import { jornadaService } from '../service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jornadaService public read visibility', () => {
  it('returns 404 semantics for a missing or hidden jornada', async () => {
    mocks.findVisibleById.mockResolvedValue(null);

    await expect(jornadaService.getById('hidden')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 semantics for a missing or hidden division', async () => {
    mocks.findVisibleByDivision.mockResolvedValue(null);

    await expect(jornadaService.findByDivision('hidden')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('preserves a visible empty division result', async () => {
    mocks.findVisibleByDivision.mockResolvedValue({ rows: [], total: 0 });

    await expect(jornadaService.findByDivision('visible')).resolves.toEqual({ rows: [], total: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ligaFindMany: vi.fn(),
  configureSchema: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.queryRaw,
      liga: { findMany: mocks.ligaFindMany },
    })),
    liga: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../../utils/rawDatabaseSchema', () => ({
  configureRawQuerySchema: mocks.configureSchema,
}));

import { ligaRepository } from './repository';

describe('consulta de ligas cercanas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calcula antes de paginar, conserva filtros y reconstruye el orden SQL', async () => {
    mocks.queryRaw.mockImplementation((query: { strings: readonly string[]; values: unknown[] }) => {
      const sql = query.strings.join('?');
      expect(sql).toContain('2 * 6371.0088');
      expect(sql).toContain('ORDER BY "distanceKm" ASC, "createdAt" DESC, id ASC');
      expect(sql).toContain('e.codigo <> \'BORRADOR\'');
      expect(sql).toContain('d."categoriaId" =');
      expect(sql).toContain('strpos(lower(l.nombre), lower(');
      expect(query.values).toEqual(expect.arrayContaining([19.433, -99.133, 'cat-1', 'Centro', 10, 10]));
      return [{
        rows: [
          { id: 'liga-b', distanceKm: 1.25 },
          { id: 'liga-a', distanceKm: 3.5 },
        ],
        total: 7,
      }];
    });
    mocks.ligaFindMany.mockResolvedValue([
      { id: 'liga-a', nombre: 'A' },
      { id: 'liga-b', nombre: 'B' },
    ]);

    const result = await ligaRepository.findAllPaginated({
      page: 2,
      limit: 10,
      search: 'Centro',
      categoriaId: 'cat-1',
      latitude: 19.433,
      longitude: -99.133,
    });

    expect(mocks.configureSchema).toHaveBeenCalledOnce();
    expect(mocks.ligaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['liga-b', 'liga-a'] } },
    }));
    expect(result).toEqual({
      rows: [
        { id: 'liga-b', nombre: 'B', distanceKm: 1.25 },
        { id: 'liga-a', nombre: 'A', distanceKm: 3.5 },
      ],
      total: 7,
    });
  });

  it('conserva el total cuando una pagina queda vacia', async () => {
    mocks.queryRaw.mockResolvedValue([{ rows: [], total: 12 }]);

    await expect(ligaRepository.findAllPaginated({
      page: 99, limit: 20, latitude: 0, longitude: 0,
    })).resolves.toEqual({ rows: [], total: 12 });
    expect(mocks.ligaFindMany).not.toHaveBeenCalled();
  });
});

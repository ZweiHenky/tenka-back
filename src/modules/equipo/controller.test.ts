import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listPaginated: vi.fn(),
  listByUser: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./service', () => ({ equipoService: mocks }));

import { equipoController } from './controller';

const team = {
  id: 'cm-team-ab12',
  nombre: 'Leones',
  nombreNormalizado: 'leones',
  logo: null,
  logoPublicId: 'private-logo-id',
  userId: 'owner-1',
};

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() } as unknown as Response;
}

describe('equipoController public DTO', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds the short code and ownership flag while removing internal fields', async () => {
    mocks.listPaginated.mockResolvedValue({ rows: [team], total: 1 });
    const req = { query: { page: '1', limit: '20' }, user: { id: 'owner-1' } } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await equipoController.list(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: {
      rows: [{ id: 'cm-team-ab12', nombre: 'Leones', logo: null, codigo: 'AB12', esPropio: true }],
      total: 1,
    } });
    expect(next).not.toHaveBeenCalled();
  });

  it('marks a team as external for an anonymous request', async () => {
    mocks.getById.mockResolvedValue(team);
    const req = { params: { id: team.id } } as unknown as Request;
    const res = response();

    await equipoController.getById(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({
      codigo: 'AB12', esPropio: false,
    }) });
  });
});

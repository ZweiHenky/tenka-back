import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../types/auth';

const mocks = vi.hoisted(() => ({ getRecentSchedule: vi.fn() }));

vi.mock('./service', () => ({
  ligaService: { getRecentSchedule: mocks.getRecentSchedule },
}));

import { ligaController } from './controller';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

describe('ligaController.getRecentSchedule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responde la programacion reciente con el envelope establecido', async () => {
    const schedule = { id: 'liga-1', nombre: 'Liga Centro', multiplesCanchas: false, divisiones: [] };
    mocks.getRecentSchedule.mockResolvedValue(schedule);
    const req = { params: { ligaId: 'liga-1' }, user: owner } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await ligaController.getRecentSchedule(req, res, next);

    expect(mocks.getRecentSchedule).toHaveBeenCalledWith('liga-1', owner);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: schedule });
    expect(next).not.toHaveBeenCalled();
  });
});

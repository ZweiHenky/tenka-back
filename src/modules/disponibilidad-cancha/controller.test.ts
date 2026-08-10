import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../types/auth';
import { ValidationError } from '../../utils/errors';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./service', () => ({ disponibilidadCanchaService: { get: mocks.get } }));

import { disponibilidadCanchaController } from './controller';

const actor: AuthenticatedUser = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };

function response(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('disponibilidadCanchaController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the standard envelope and parsed dates', async () => {
    const data = { ligaId: 'liga', mode: 'SINGLE' };
    mocks.get.mockResolvedValue(data);
    const req = {
      params: { ligaId: 'liga' },
      query: { inicio: '2026-08-01T00:00:00Z', fin: '2026-08-02T00:00:00Z' },
      user: actor,
    } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await disponibilidadCanchaController.get(req, res, next);

    expect(mocks.get).toHaveBeenCalledWith(
      'liga',
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-08-02T00:00:00Z'),
      actor,
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards validation errors without invoking the service', async () => {
    const req = {
      params: { ligaId: 'liga' },
      query: { inicio: 'invalid', fin: '2026-08-02T00:00:00Z' },
      user: actor,
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await disponibilidadCanchaController.get(req, response(), next);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});

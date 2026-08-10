import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ generateNext: vi.fn() }));

vi.mock('../service', () => ({ jornadaService: { generateNext: mocks.generateNext } }));

import { jornadaController } from '../controller';

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status } as unknown as Response, status, json };
}

describe('jornadaController.generateNext', () => {
  it('requires an idempotency key', async () => {
    const req = {
      params: { divisionId: 'division-1' }, body: { equipoIds: ['a', 'b'] }, user: { id: 'owner' }, get: vi.fn(() => undefined),
    } as unknown as Request;
    const { res } = response();
    const next = vi.fn() as unknown as NextFunction;

    await jornadaController.generateNext(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    expect(mocks.generateNext).not.toHaveBeenCalled();
  });

  it.each([
    [false, 201, 'Jornada generada exitosamente'],
    [true, 200, 'Jornada generada previamente'],
  ])('uses the replay-aware response status', async (idempotencyReplayed, expectedStatus, message) => {
    mocks.generateNext.mockResolvedValue({ id: 'jornada-1', numero: 1, idempotencyReplayed });
    const req = {
      params: { divisionId: 'division-1' }, body: { equipoIds: ['a', 'b'] }, user: { id: 'owner' }, get: vi.fn(() => 'generation-key-1'),
    } as unknown as Request;
    const { res, status, json } = response();
    const next = vi.fn() as unknown as NextFunction;

    await jornadaController.generateNext(req, res, next);

    expect(mocks.generateNext).toHaveBeenCalledWith('division-1', req.user, undefined, ['a', 'b'], undefined, 'generation-key-1');
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith({ success: true, data: { id: 'jornada-1', numero: 1 }, message });
    expect(next).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ findByDivision: vi.fn() }));

vi.mock('../service', () => ({ jornadaService: { findByDivision: mocks.findByDivision } }));

import { jornadaController } from '../controller';

describe('jornadaController.findByDivision', () => {
  it('keeps page 1 and limit 10 as the default pagination', async () => {
    const result = { rows: [], total: 0 };
    mocks.findByDivision.mockResolvedValue(result);
    const req = { params: { divisionId: 'd-1' }, query: {}, user: undefined } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await jornadaController.findByDivision(req, res, next);

    expect(mocks.findByDivision).toHaveBeenCalledWith('d-1', { skip: 0, take: 10 }, undefined);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });
});

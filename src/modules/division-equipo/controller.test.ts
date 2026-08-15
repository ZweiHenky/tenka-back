import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../types/auth';

const mocks = vi.hoisted(() => ({ findByDivision: vi.fn(), updateSaldoPendiente: vi.fn() }));

vi.mock('./service', () => ({
  divisionEquipoService: {
    findByDivision: mocks.findByDivision,
    updateSaldoPendiente: mocks.updateSaldoPendiente,
  },
}));

import { divisionEquipoController } from './controller';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

function request(body: unknown) {
  return {
    params: { divisionId: 'division-1', equipoId: 'equipo-1' },
    body,
    user: owner,
  } as unknown as Request;
}

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('divisionEquipoController.updateSaldoPendiente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canonicalizes the payload and returns the required message', async () => {
    mocks.updateSaldoPendiente.mockResolvedValue({
      divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '7.50',
    });
    const res = response();
    const next = vi.fn() as NextFunction;

    await divisionEquipoController.updateSaldoPendiente(request({ saldoPendiente: '7.5' }), res, next);

    expect(mocks.updateSaldoPendiente).toHaveBeenCalledWith(
      'division-1', 'equipo-1', '7.50', owner,
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '7.50' },
      message: 'Saldo pendiente actualizado',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects extra payload fields before calling the service', async () => {
    const next = vi.fn() as NextFunction;

    await divisionEquipoController.updateSaldoPendiente(
      request({ saldoPendiente: '7.50', extra: true }), response(), next,
    );

    expect(mocks.updateSaldoPendiente).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  it('forwards the anti-enumeration 404 from the service', async () => {
    const error = Object.assign(new Error('Equipo de la división no encontrado'), { statusCode: 404 });
    mocks.updateSaldoPendiente.mockRejectedValue(error);
    const next = vi.fn() as NextFunction;

    await divisionEquipoController.updateSaldoPendiente(request({ saldoPendiente: '7.50' }), response(), next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('divisionEquipoController.findByDivision', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a public team summary without exposing its owner id', async () => {
    mocks.findByDivision.mockResolvedValue([{
      divisionId: 'division-1',
      equipoId: 'cm-team-ab12',
      saldoPendiente: '0.00',
      equipo: { id: 'cm-team-ab12', nombre: 'Leones', logo: null, userId: owner.id },
    }]);
    const res = response();
    const next = vi.fn() as NextFunction;

    await divisionEquipoController.findByDivision(request(undefined), res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{
        divisionId: 'division-1',
        equipoId: 'cm-team-ab12',
        saldoPendiente: '0.00',
        equipo: { id: 'cm-team-ab12', nombre: 'Leones', logo: null, codigo: 'AB12', esPropio: true },
      }],
    });
    expect(next).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requireRoleMiddleware = vi.fn((_req, _res, next) => next());
  return {
    requireAuth: vi.fn((_req, _res, next) => next()),
    requireRoleMiddleware,
    requireRole: vi.fn(() => requireRoleMiddleware),
    lookupLimiter: vi.fn((_req, _res, next) => next()),
    lookupByPhone: vi.fn(),
  };
});

vi.mock('../../middlewares/authMiddleware', () => ({
  optionalAuth: vi.fn((_req, _res, next) => next()),
  requireAuth: mocks.requireAuth,
  requireRole: mocks.requireRole,
}));

vi.mock('../../middlewares/rateLimits', () => ({
  playerPhoneLookupLimiter: mocks.lookupLimiter,
}));

vi.mock('./controller', () => ({
  jugadorController: {
    list: vi.fn(),
    getMe: vi.fn(),
    listDivisionsByPlayer: vi.fn(),
    listByDivisionTeam: vi.fn(),
    getById: vi.fn(),
    createMe: vi.fn(),
    updateMe: vi.fn(),
    lookupByPhone: mocks.lookupByPhone,
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    assignToTeam: vi.fn(),
    removeFromTeam: vi.fn(),
    assignToDivision: vi.fn(),
    removeFromDivision: vi.fn(),
  },
}));

import { jugadorRouter } from './routes';

describe('jugador phone lookup route', () => {
  it('is mounted at the specific path with role authorization and its dedicated limiter', () => {
    const layer = (jugadorRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/equipo/:equipoId/buscar' && entry.route?.methods?.post,
    );

    expect(layer).toBeDefined();
    expect(layer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireRoleMiddleware,
      mocks.lookupLimiter,
      mocks.lookupByPhone,
    ]);
    expect(mocks.requireRole).toHaveBeenCalledWith('CAPITAN', 'LIGA');
  });
});

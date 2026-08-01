import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activateLeagueRole: vi.fn() }));

vi.mock('./service', () => ({
  userService: { activateLeagueRole: mocks.activateLeagueRole },
}));

vi.mock('../../config/database', () => ({ prisma: { user: {} } }));
vi.mock('../media/service', () => ({ mediaService: { scheduleImageCleanup: vi.fn() } }));

import { userController } from './controller';

describe('userController.activateLeagueRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses only the authenticated user id and ignores body overrides', async () => {
    const user = { id: 'session-user', email: 'user@test.com', rol: 'LIGA' };
    mocks.activateLeagueRole.mockResolvedValue(user);
    const req = {
      user: { id: 'session-user', rol: 'CAPITAN' },
      body: { userId: 'other-user', id: 'other-user', rol: 'ADMINISTRADOR' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await userController.activateLeagueRole(req, res, next);

    expect(mocks.activateLeagueRole).toHaveBeenCalledOnce();
    expect(mocks.activateLeagueRole).toHaveBeenCalledWith('session-user');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: user, message: 'Rol de liga activado' });
    expect(next).not.toHaveBeenCalled();
  });
});

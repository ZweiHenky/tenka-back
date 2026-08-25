import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ activateLeagueRole: vi.fn(), deleteAccount: vi.fn(), getAccountQuota: vi.fn() }));

vi.mock('./service', () => ({
  userService: { activateLeagueRole: mocks.activateLeagueRole, deleteAccount: mocks.deleteAccount },
}));

vi.mock('../../config/database', () => ({ prisma: { user: {} } }));
vi.mock('../media/service', () => ({ mediaService: { scheduleImageCleanup: vi.fn() } }));
vi.mock('../../utils/accountQuota', () => ({ getAccountQuota: mocks.getAccountQuota }));

import { userController } from './controller';

describe('userController.quota', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads quota for only the authenticated account', async () => {
    const quota = {
      role: 'CAPITAN',
      limits: { teams: 10, leagues: 0, divisions: 0, activeDivisions: 0 },
      usage: { teams: 2, leagues: 0, divisions: 0, activeDivisions: 0 },
    };
    mocks.getAccountQuota.mockResolvedValue(quota);
    const req = { user: { id: 'session-user' }, query: { userId: 'other-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await userController.quota(req, res, next);

    expect(mocks.getAccountQuota).toHaveBeenCalledWith('session-user');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: quota });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an administrator to read the resource owner quota', async () => {
    const quota = { role: 'LIGA', limits: {}, usage: {} };
    mocks.getAccountQuota.mockResolvedValue(quota);
    const req = { user: { id: 'admin-user', rol: 'ADMINISTRADOR' }, params: { userId: 'owner-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await userController.quotaByUser(req, res, next);

    expect(mocks.getAccountQuota).toHaveBeenCalledWith('owner-user');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: quota });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects reading another account quota without administrator role', async () => {
    const req = { user: { id: 'session-user', rol: 'LIGA' }, params: { userId: 'other-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await userController.quotaByUser(req, res, next);

    expect(mocks.getAccountQuota).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

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

describe('userController.deleteAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the service with the session user id and validated email', async () => {
    mocks.deleteAccount.mockResolvedValue(undefined);
    const req = {
      user: { id: 'session-user', rol: 'CAPITAN' },
      body: { email: 'user@test.com' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), end: vi.fn() } as any;
    const next = vi.fn();

    await userController.deleteAccount(req, res, next);

    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
    expect(mocks.deleteAccount).toHaveBeenCalledWith('session-user', 'user@test.com');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid email payload', async () => {
    const req = { user: { id: 'session-user' }, body: { email: 'not-an-email' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await userController.deleteAccount(req, res, next);

    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    user: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}));

import { userService } from './service';

describe('userService.activateLeagueRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ['CAPITAN', 'LIGA'],
    ['LIGA', 'LIGA'],
    ['ADMINISTRADOR', 'ADMINISTRADOR'],
  ] as const)('transitions %s to %s without changing other roles', async (_initialRole, resultingRole) => {
    const user = { id: 'session-user', email: 'user@test.com', rol: resultingRole };
    mocks.findUnique.mockResolvedValue(user);

    await expect(userService.activateLeagueRole('session-user')).resolves.toEqual(user);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-user', rol: 'CAPITAN' },
      data: { rol: 'LIGA' },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 'session-user' },
      select: expect.not.objectContaining({ imagePublicId: true }),
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  ligaFindMany: vi.fn(),
  ligaDeleteMany: vi.fn(),
  equipoFindMany: vi.fn(),
  equipoDeleteMany: vi.fn(),
  jugadorFindFirst: vi.fn(),
  jugadorDelete: vi.fn(),
  refereeAccessDeleteMany: vi.fn(),
  subscriptionsFindMany: vi.fn(),
  subscriptionsDeleteMany: vi.fn(),
  cleanupUpsert: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  userDelete: vi.fn(),
  scheduleImageCleanup: vi.fn(),
  scheduleDeletion: vi.fn(),
  signalBackgroundJob: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../media/service', () => ({
  mediaService: { scheduleImageCleanup: mocks.scheduleImageCleanup, scheduleDeletion: mocks.scheduleDeletion },
}));

vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: mocks.signalBackgroundJob }));

import { userService } from './service';
import { ValidationError, NotFoundError } from '../../utils/errors';

const tx = {
  liga: { findMany: mocks.ligaFindMany, deleteMany: mocks.ligaDeleteMany },
  equipo: { findMany: mocks.equipoFindMany, deleteMany: mocks.equipoDeleteMany },
  jugador: { findFirst: mocks.jugadorFindFirst, delete: mocks.jugadorDelete },
  partidoRefereeAccess: { deleteMany: mocks.refereeAccessDeleteMany },
  divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany, deleteMany: mocks.subscriptionsDeleteMany },
  oneSignalTagCleanupJob: { upsert: mocks.cleanupUpsert },
  mediaAsset: { findMany: mocks.mediaAssetFindMany },
  user: { delete: mocks.userDelete },
};

describe('userService.deleteAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ email: 'user@test.com', image: 'https://cdn.test/avatar.jpg', imagePublicId: 'tenka/avatar' });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.ligaFindMany.mockResolvedValue([
      { logo: 'https://cdn.test/logo.jpg', logoPublicId: 'tenka/logo', cancha: 'https://cdn.test/cover.jpg', canchaPublicId: 'tenka/cover' },
    ]);
    mocks.equipoFindMany.mockResolvedValue([{ logo: 'https://cdn.test/team.jpg', logoPublicId: 'tenka/team' }]);
    mocks.jugadorFindFirst.mockResolvedValue({ id: 'jugador-1', foto: 'https://cdn.test/photo.jpg', fotoPublicId: 'tenka/photo' });
    mocks.subscriptionsFindMany.mockResolvedValue([{ oneSignalId: 'os-1', divisionId: 'division-1' }]);
    mocks.mediaAssetFindMany.mockResolvedValue([{ publicId: 'tenka/pending' }]);
  });

  it('throws a ValidationError when the email does not match the account', async () => {
    mocks.userFindUnique.mockResolvedValue({ email: 'user@test.com' });

    await expect(userService.deleteAccount('user-1', 'other@test.com')).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('throws a NotFoundError when the user does not exist', async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(userService.deleteAccount('missing', 'user@test.com')).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('deletes leagues, teams, player profile and referee access in a transaction', async () => {
    await userService.deleteAccount('user-1', 'user@test.com');

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.ligaFindMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: expect.anything() });
    expect(mocks.ligaDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.equipoDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.jugadorDelete).toHaveBeenCalledWith({ where: { id: 'jugador-1' } });
    expect(mocks.refereeAccessDeleteMany).toHaveBeenCalledWith({ where: { createdById: 'user-1' } });
    expect(mocks.subscriptionsDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('schedules Cloudinary cleanup for league, team, player and account images', async () => {
    await userService.deleteAccount('user-1', 'user@test.com');

    expect(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/logo.jpg', 'tenka/logo', tx);
    expect(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/cover.jpg', 'tenka/cover', tx);
    expect(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/team.jpg', 'tenka/team', tx);
    expect(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/photo.jpg', 'tenka/photo', tx);
    expect(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/avatar.jpg', 'tenka/avatar', tx);
    expect(mocks.scheduleDeletion).toHaveBeenCalledWith('tenka/pending', tx);
  });

  it('queues OneSignal tag cleanup for the followed divisions and removes subscriptions', async () => {
    await userService.deleteAccount('user-1', 'user@test.com');

    expect(mocks.cleanupUpsert).toHaveBeenCalledWith({
      where: { oneSignalId_tag: { oneSignalId: 'os-1', tag: 'division_division-1' } },
      create: { oneSignalId: 'os-1', tag: 'division_division-1', desired: false },
      update: expect.objectContaining({ desired: false, status: 'PENDING' }),
    });
  });

  it('signals the background jobs after committing', async () => {
    await userService.deleteAccount('user-1', 'user@test.com');

    expect(mocks.signalBackgroundJob).toHaveBeenCalledWith('media-deletion');
    expect(mocks.signalBackgroundJob).toHaveBeenCalledWith('tag-cleanup');
  });
});
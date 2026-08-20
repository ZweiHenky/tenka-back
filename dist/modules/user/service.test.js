"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    userFindUnique: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
    ligaFindMany: vitest_1.vi.fn(),
    ligaDeleteMany: vitest_1.vi.fn(),
    equipoFindMany: vitest_1.vi.fn(),
    equipoDeleteMany: vitest_1.vi.fn(),
    jugadorFindFirst: vitest_1.vi.fn(),
    jugadorDelete: vitest_1.vi.fn(),
    refereeAccessDeleteMany: vitest_1.vi.fn(),
    subscriptionsFindMany: vitest_1.vi.fn(),
    subscriptionsDeleteMany: vitest_1.vi.fn(),
    cleanupUpsert: vitest_1.vi.fn(),
    mediaAssetFindMany: vitest_1.vi.fn(),
    userDelete: vitest_1.vi.fn(),
    scheduleImageCleanup: vitest_1.vi.fn(),
    scheduleDeletion: vitest_1.vi.fn(),
    signalBackgroundJob: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
        user: { findUnique: mocks.userFindUnique },
    },
}));
vitest_1.vi.mock('../media/service', () => ({
    mediaService: { scheduleImageCleanup: mocks.scheduleImageCleanup, scheduleDeletion: mocks.scheduleDeletion },
}));
vitest_1.vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: mocks.signalBackgroundJob }));
const service_1 = require("./service");
const errors_1 = require("../../utils/errors");
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
(0, vitest_1.describe)('userService.deleteAccount', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
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
    (0, vitest_1.it)('throws a ValidationError when the email does not match the account', async () => {
        mocks.userFindUnique.mockResolvedValue({ email: 'user@test.com' });
        await (0, vitest_1.expect)(service_1.userService.deleteAccount('user-1', 'other@test.com')).rejects.toBeInstanceOf(errors_1.ValidationError);
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('throws a NotFoundError when the user does not exist', async () => {
        mocks.userFindUnique.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.userService.deleteAccount('missing', 'user@test.com')).rejects.toBeInstanceOf(errors_1.NotFoundError);
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('deletes leagues, teams, player profile and referee access in a transaction', async () => {
        await service_1.userService.deleteAccount('user-1', 'user@test.com');
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.ligaFindMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: vitest_1.expect.anything() });
        (0, vitest_1.expect)(mocks.ligaDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        (0, vitest_1.expect)(mocks.equipoDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        (0, vitest_1.expect)(mocks.jugadorDelete).toHaveBeenCalledWith({ where: { id: 'jugador-1' } });
        (0, vitest_1.expect)(mocks.refereeAccessDeleteMany).toHaveBeenCalledWith({ where: { createdById: 'user-1' } });
        (0, vitest_1.expect)(mocks.subscriptionsDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        (0, vitest_1.expect)(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
    (0, vitest_1.it)('schedules Cloudinary cleanup for league, team, player and account images', async () => {
        await service_1.userService.deleteAccount('user-1', 'user@test.com');
        (0, vitest_1.expect)(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/logo.jpg', 'tenka/logo', tx);
        (0, vitest_1.expect)(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/cover.jpg', 'tenka/cover', tx);
        (0, vitest_1.expect)(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/team.jpg', 'tenka/team', tx);
        (0, vitest_1.expect)(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/photo.jpg', 'tenka/photo', tx);
        (0, vitest_1.expect)(mocks.scheduleImageCleanup).toHaveBeenCalledWith('https://cdn.test/avatar.jpg', 'tenka/avatar', tx);
        (0, vitest_1.expect)(mocks.scheduleDeletion).toHaveBeenCalledWith('tenka/pending', tx);
    });
    (0, vitest_1.it)('queues OneSignal tag cleanup for the followed divisions and removes subscriptions', async () => {
        await service_1.userService.deleteAccount('user-1', 'user@test.com');
        (0, vitest_1.expect)(mocks.cleanupUpsert).toHaveBeenCalledWith({
            where: { oneSignalId_tag: { oneSignalId: 'os-1', tag: 'division_division-1' } },
            create: { oneSignalId: 'os-1', tag: 'division_division-1', desired: false },
            update: vitest_1.expect.objectContaining({ desired: false, status: 'PENDING' }),
        });
    });
    (0, vitest_1.it)('signals the background jobs after committing', async () => {
        await service_1.userService.deleteAccount('user-1', 'user@test.com');
        (0, vitest_1.expect)(mocks.signalBackgroundJob).toHaveBeenCalledWith('media-deletion');
        (0, vitest_1.expect)(mocks.signalBackgroundJob).toHaveBeenCalledWith('tag-cleanup');
    });
});
//# sourceMappingURL=service.test.js.map
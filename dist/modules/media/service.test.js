"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    sign: vitest_1.vi.fn(() => 'signature'),
    resource: vitest_1.vi.fn(),
    destroy: vitest_1.vi.fn(),
    assetCreate: vitest_1.vi.fn(),
    assetFindFirst: vitest_1.vi.fn(),
    assetUpdateMany: vitest_1.vi.fn(),
    deletionDeleteMany: vitest_1.vi.fn(),
    deletionUpdateMany: vitest_1.vi.fn(),
    userCount: vitest_1.vi.fn(),
    ligaCount: vitest_1.vi.fn(),
    equipoCount: vitest_1.vi.fn(),
    jugadorCount: vitest_1.vi.fn(),
    queryRaw: vitest_1.vi.fn(),
    sentry: vitest_1.vi.fn(),
    signalJob: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('cloudinary', () => ({
    v2: {
        config: vitest_1.vi.fn(),
        utils: { api_sign_request: mocks.sign },
        api: { resource: mocks.resource },
        uploader: { destroy: mocks.destroy },
    },
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        mediaAsset: { create: mocks.assetCreate, findFirst: mocks.assetFindFirst, updateMany: mocks.assetUpdateMany },
        mediaDeletionJob: { deleteMany: mocks.deletionDeleteMany, updateMany: mocks.deletionUpdateMany },
        user: { count: mocks.userCount },
        liga: { count: mocks.ligaCount },
        equipo: { count: mocks.equipoCount },
        jugador: { count: mocks.jugadorCount },
        $queryRaw: mocks.queryRaw,
    },
}));
vitest_1.vi.mock('../../instrument', () => ({ Sentry: { captureException: mocks.sentry } }));
vitest_1.vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: mocks.signalJob }));
const service_1 = require("./service");
const publicId = 'tenka/local/user-1/team_logo/asset';
const secureUrl = `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.webp`;
(0, vitest_1.describe)('mediaService upload lifecycle', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.assetCreate.mockResolvedValue({ id: 'intent-1' });
        mocks.assetUpdateMany.mockResolvedValue({ count: 1 });
        mocks.userCount.mockResolvedValue(0);
        mocks.ligaCount.mockResolvedValue(0);
        mocks.equipoCount.mockResolvedValue(0);
        mocks.jugadorCount.mockResolvedValue(0);
    });
    (0, vitest_1.it)('creates a server-owned namespace and signs the exact policy', async () => {
        const result = await service_1.mediaService.createUploadIntent('user-1', 'TEAM_LOGO');
        (0, vitest_1.expect)(result.publicId).toMatch(/^tenka\/local\/user-1\/team_logo\/[0-9a-f-]{36}$/);
        (0, vitest_1.expect)(result.uploadParams).toMatchObject({
            public_id: result.publicId,
            allowed_formats: 'jpg,jpeg,png,webp,heic',
            overwrite: false,
            transformation: 'c_fill,g_center,w_200,h_200',
        });
        (0, vitest_1.expect)(mocks.sign).toHaveBeenCalledWith(result.uploadParams, 'test-cloudinary-api-secret');
        (0, vitest_1.expect)(mocks.assetCreate).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ ownerId: 'user-1', kind: 'TEAM_LOGO', publicId: result.publicId }) }));
        (0, vitest_1.expect)(mocks.signalJob).toHaveBeenCalledWith('media-intents', vitest_1.expect.any(Date));
    });
    (0, vitest_1.it)('rejects another owner and a mismatched public ID before provider verification', async () => {
        mocks.assetFindFirst.mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(service_1.mediaService.completeUpload('other', 'intent-1', {
            public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
        })).rejects.toMatchObject({ statusCode: 404 });
        mocks.assetFindFirst.mockResolvedValueOnce({ id: 'intent-1', ownerId: 'user-1', kind: 'TEAM_LOGO', publicId, status: 'PENDING', expiresAt: new Date(Date.now() + 10000) });
        await (0, vitest_1.expect)(service_1.mediaService.completeUpload('user-1', 'intent-1', {
            public_id: 'attacker/id', secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
        })).rejects.toThrow('public ID');
        (0, vitest_1.expect)(mocks.resource).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects a foreign delivery host and accepts verified exact metadata', async () => {
        const intent = { id: 'intent-1', ownerId: 'user-1', kind: 'TEAM_LOGO', publicId, status: 'PENDING', expiresAt: new Date(Date.now() + 10000) };
        mocks.assetFindFirst.mockResolvedValue(intent);
        await (0, vitest_1.expect)(service_1.mediaService.completeUpload('user-1', 'intent-1', {
            public_id: publicId, secure_url: `https://evil.example/${publicId}.webp`, bytes: 10, format: 'webp', width: 200, height: 200,
        })).rejects.toThrow('URL');
        mocks.resource.mockResolvedValue({ public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200, pages: 1 });
        await (0, vitest_1.expect)(service_1.mediaService.completeUpload('user-1', 'intent-1', {
            public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
        })).resolves.toEqual({ mediaAssetId: 'intent-1', url: secureUrl });
        (0, vitest_1.expect)(mocks.assetUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'UPLOADED' }) }));
    });
    (0, vitest_1.it)('atomically resolves and consumes an attachment', async () => {
        const tx = {
            mediaAsset: {
                findFirst: vitest_1.vi.fn().mockResolvedValue({ id: 'asset-1', publicId, secureUrl, status: 'UPLOADED' }),
                updateMany: vitest_1.vi.fn().mockResolvedValue({ count: 1 }),
            },
            mediaDeletionJob: { upsert: vitest_1.vi.fn() },
        };
        await (0, vitest_1.expect)(service_1.mediaService.prepareAttachment(tx, 'asset-1', 'user-1', 'TEAM_LOGO')).resolves.toEqual({ url: secureUrl, publicId });
        (0, vitest_1.expect)(tx.mediaAsset.findFirst).toHaveBeenCalledWith({ where: vitest_1.expect.objectContaining({ ownerId: 'user-1', kind: 'TEAM_LOGO', status: 'UPLOADED' }) });
        (0, vitest_1.expect)(tx.mediaAsset.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'ATTACHED' }) }));
    });
});
(0, vitest_1.describe)('mediaService deletion worker', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.queryRaw.mockResolvedValue([{ id: 'job-1', publicId, attempts: 1, maxAttempts: 8 }]);
        mocks.deletionDeleteMany.mockResolvedValue({ count: 1 });
        mocks.deletionUpdateMany.mockResolvedValue({ count: 1 });
    });
    vitest_1.it.each(['ok', 'not found'])('removes a successful %s job', async (result) => {
        mocks.destroy.mockResolvedValue({ result });
        await service_1.mediaService.processDeletionJobs();
        (0, vitest_1.expect)(mocks.destroy).toHaveBeenCalledWith(publicId, vitest_1.expect.objectContaining({ invalidate: true }));
        (0, vitest_1.expect)(mocks.deletionDeleteMany).toHaveBeenCalled();
    });
    (0, vitest_1.it)('claims with row locking so concurrent workers cannot receive the same due job', async () => {
        mocks.queryRaw.mockResolvedValue([]);
        await service_1.mediaService.claimDeletionJobs('worker-1', 5);
        const sql = mocks.queryRaw.mock.calls[0][0].join(' ');
        (0, vitest_1.expect)(sql).toContain('FOR UPDATE SKIP LOCKED');
        (0, vitest_1.expect)(sql).toContain("status = 'LEASED'");
    });
    (0, vitest_1.it)('turns a provider timeout into an isolated retry', async () => {
        vitest_1.vi.useFakeTimers();
        mocks.destroy.mockReturnValue(new Promise(() => undefined));
        const processing = service_1.mediaService.processDeletionJobs();
        await vitest_1.vi.advanceTimersByTimeAsync(5001);
        await processing;
        (0, vitest_1.expect)(mocks.deletionUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'PENDING' }) }));
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('releases a failed lease with backoff without reporting Sentry', async () => {
        mocks.destroy.mockRejectedValue(new Error('provider down'));
        await service_1.mediaService.processDeletionJobs();
        (0, vitest_1.expect)(mocks.deletionUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ attempts: 1, status: 'PENDING', lockedBy: null, leaseUntil: null }) }));
        (0, vitest_1.expect)(mocks.sentry).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('marks attempt eight dead and reports Sentry once', async () => {
        mocks.queryRaw.mockResolvedValue([{ id: 'job-1', publicId, attempts: 8, maxAttempts: 8 }]);
        mocks.destroy.mockResolvedValue({ result: 'error' });
        await service_1.mediaService.processDeletionJobs();
        (0, vitest_1.expect)(mocks.deletionUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ attempts: 8, status: 'DEAD', deadAt: vitest_1.expect.any(Date) }) }));
        (0, vitest_1.expect)(mocks.sentry).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=service.test.js.map
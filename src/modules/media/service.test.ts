import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sign: vi.fn(() => 'signature'),
  resource: vi.fn(),
  destroy: vi.fn(),
  assetCreate: vi.fn(),
  assetFindFirst: vi.fn(),
  assetUpdateMany: vi.fn(),
  deletionDeleteMany: vi.fn(),
  deletionUpdateMany: vi.fn(),
  userCount: vi.fn(),
  ligaCount: vi.fn(),
  equipoCount: vi.fn(),
  jugadorCount: vi.fn(),
  queryRaw: vi.fn(),
  sentry: vi.fn(),
  signalJob: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    utils: { api_sign_request: mocks.sign },
    api: { resource: mocks.resource },
    uploader: { destroy: mocks.destroy },
  },
}));
vi.mock('../../config/database', () => ({
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
vi.mock('../../instrument', () => ({ Sentry: { captureException: mocks.sentry } }));
vi.mock('../../workers/jobSignals', () => ({ signalBackgroundJob: mocks.signalJob }));

import { mediaService } from './service';

const publicId = 'tenka/local/user-1/team_logo/asset';
const secureUrl = `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.webp`;

describe('mediaService upload lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assetCreate.mockResolvedValue({ id: 'intent-1' });
    mocks.assetUpdateMany.mockResolvedValue({ count: 1 });
    mocks.userCount.mockResolvedValue(0);
    mocks.ligaCount.mockResolvedValue(0);
    mocks.equipoCount.mockResolvedValue(0);
    mocks.jugadorCount.mockResolvedValue(0);
  });

  it('creates a server-owned namespace and signs the exact policy', async () => {
    const result = await mediaService.createUploadIntent('user-1', 'TEAM_LOGO');
    expect(result.publicId).toMatch(/^tenka\/local\/user-1\/team_logo\/[0-9a-f-]{36}$/);
    expect(result.uploadParams).toMatchObject({
      public_id: result.publicId,
      allowed_formats: 'jpg,jpeg,png,webp,heic',
      overwrite: false,
      transformation: 'c_fill,g_center,w_200,h_200',
    });
    expect(mocks.sign).toHaveBeenCalledWith(result.uploadParams, 'test-cloudinary-api-secret');
    expect(mocks.assetCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: 'user-1', kind: 'TEAM_LOGO', publicId: result.publicId }) }));
    expect(mocks.signalJob).toHaveBeenCalledWith('media-intents', expect.any(Date));
  });

  it('rejects another owner and a mismatched public ID before provider verification', async () => {
    mocks.assetFindFirst.mockResolvedValueOnce(null);
    await expect(mediaService.completeUpload('other', 'intent-1', {
      public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
    })).rejects.toMatchObject({ statusCode: 404 });

    mocks.assetFindFirst.mockResolvedValueOnce({ id: 'intent-1', ownerId: 'user-1', kind: 'TEAM_LOGO', publicId, status: 'PENDING', expiresAt: new Date(Date.now() + 10000) });
    await expect(mediaService.completeUpload('user-1', 'intent-1', {
      public_id: 'attacker/id', secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
    })).rejects.toThrow('public ID');
    expect(mocks.resource).not.toHaveBeenCalled();
  });

  it('rejects a foreign delivery host and accepts verified exact metadata', async () => {
    const intent = { id: 'intent-1', ownerId: 'user-1', kind: 'TEAM_LOGO', publicId, status: 'PENDING', expiresAt: new Date(Date.now() + 10000) };
    mocks.assetFindFirst.mockResolvedValue(intent);
    await expect(mediaService.completeUpload('user-1', 'intent-1', {
      public_id: publicId, secure_url: `https://evil.example/${publicId}.webp`, bytes: 10, format: 'webp', width: 200, height: 200,
    })).rejects.toThrow('URL');

    mocks.resource.mockResolvedValue({ public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200, pages: 1 });
    await expect(mediaService.completeUpload('user-1', 'intent-1', {
      public_id: publicId, secure_url: secureUrl, bytes: 10, format: 'webp', width: 200, height: 200,
    })).resolves.toEqual({ mediaAssetId: 'intent-1', url: secureUrl });
    expect(mocks.assetUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'UPLOADED' }) }));
  });

  it('atomically resolves and consumes an attachment', async () => {
    const tx = {
      mediaAsset: {
        findFirst: vi.fn().mockResolvedValue({ id: 'asset-1', publicId, secureUrl, status: 'UPLOADED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mediaDeletionJob: { upsert: vi.fn() },
    } as any;
    await expect(mediaService.prepareAttachment(tx, 'asset-1', 'user-1', 'TEAM_LOGO')).resolves.toEqual({ url: secureUrl, publicId });
    expect(tx.mediaAsset.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ ownerId: 'user-1', kind: 'TEAM_LOGO', status: 'UPLOADED' }) });
    expect(tx.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ATTACHED' }) }));
  });
});

describe('mediaService deletion worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ id: 'job-1', publicId, attempts: 1, maxAttempts: 8 }]);
    mocks.deletionDeleteMany.mockResolvedValue({ count: 1 });
    mocks.deletionUpdateMany.mockResolvedValue({ count: 1 });
  });

  it.each(['ok', 'not found'])('removes a successful %s job', async (result) => {
    mocks.destroy.mockResolvedValue({ result });
    await mediaService.processDeletionJobs();
    expect(mocks.destroy).toHaveBeenCalledWith(publicId, expect.objectContaining({ invalidate: true }));
    expect(mocks.deletionDeleteMany).toHaveBeenCalled();
  });

  it('claims with row locking so concurrent workers cannot receive the same due job', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await mediaService.claimDeletionJobs('worker-1', 5);
    const sql = (mocks.queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'LEASED'");
  });

  it('turns a provider timeout into an isolated retry', async () => {
    vi.useFakeTimers();
    mocks.destroy.mockReturnValue(new Promise(() => undefined));
    const processing = mediaService.processDeletionJobs();
    await vi.advanceTimersByTimeAsync(5001);
    await processing;
    expect(mocks.deletionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }));
    vi.useRealTimers();
  });

  it('releases a failed lease with backoff without reporting Sentry', async () => {
    mocks.destroy.mockRejectedValue(new Error('provider down'));
    await mediaService.processDeletionJobs();
    expect(mocks.deletionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attempts: 1, status: 'PENDING', lockedBy: null, leaseUntil: null }) }));
    expect(mocks.sentry).not.toHaveBeenCalled();
  });

  it('marks attempt eight dead and reports Sentry once', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'job-1', publicId, attempts: 8, maxAttempts: 8 }]);
    mocks.destroy.mockResolvedValue({ result: 'error' });
    await mediaService.processDeletionJobs();
    expect(mocks.deletionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attempts: 8, status: 'DEAD', deadAt: expect.any(Date) }) }));
    expect(mocks.sentry).toHaveBeenCalledTimes(1);
  });
});

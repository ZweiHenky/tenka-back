import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  outboxUpdateMany: vi.fn(),
  jornadaFindUnique: vi.fn(),
  divisionFindUnique: vi.fn(),
  ownerFindMany: vi.fn(),
  followerFindMany: vi.fn(),
  send: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    notificationOutbox: { updateMany: mocks.outboxUpdateMany },
    jornada: { findUnique: mocks.jornadaFindUnique },
    division: { findUnique: mocks.divisionFindUnique },
    divisionEquipo: { findMany: mocks.ownerFindMany },
    divisionNotificationSubscription: { findMany: mocks.followerFindMany },
  },
}));
vi.mock('../notification-subscription/onesignal-client', async (original) => ({
  ...(await original<typeof import('../notification-subscription/onesignal-client')>()),
  sendNotification: mocks.send,
}));
vi.mock('../../instrument', () => ({ Sentry: { captureException: mocks.capture } }));
vi.mock('../../config/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { OneSignalProviderError } from '../notification-subscription/onesignal-client';
import { notificationService } from './service';

const job = {
  id: 'job-1', jornadaId: 'jornada-1', divisionId: 'division-1', audience: 'REGISTERED' as const,
  eventType: 'JORNADA_GENERATED' as const, payload: null, targetUserIds: null,
  providerIdempotencyKey: 'stable-provider-key', attempts: 1, maxAttempts: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([job]);
  mocks.jornadaFindUnique.mockResolvedValue({
    id: 'jornada-1', numero: 2,
    division: { id: 'division-1', nombre: 'Primera', ligaId: 'liga-1', liga: { nombre: 'Liga' } },
  });
  mocks.divisionFindUnique.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1' });
  mocks.ownerFindMany.mockResolvedValue([{ equipo: { userId: 'owner-1' } }, { equipo: { userId: 'owner-1' } }]);
  mocks.followerFindMany.mockResolvedValue([]);
  mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
  mocks.send.mockResolvedValue(undefined);
});

describe('notification outbox worker', () => {
  it('sends once with unique owners and the stable provider key, then completes conditionally', async () => {
    await notificationService.processOutboxJobs();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ include_aliases: { external_id: ['owner-1'] } }), 'stable-provider-key');
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', status: 'PROCESSING', lockedBy: expect.any(String) }),
      data: expect.objectContaining({ status: 'SENT', lockedBy: null, leaseUntil: null }),
    }));
  });

  it('honors a transient 429 retry and does not report it to Sentry', async () => {
    mocks.send.mockRejectedValue(new OneSignalProviderError('http_429', true, 120_000, 429));
    await notificationService.processOutboxJobs();
    expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', attempts: 1, lastErrorCode: 'http_429', nextAttemptAt: expect.any(Date) }),
    }));
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('marks the eighth transient attempt dead and captures exactly once', async () => {
    mocks.queryRaw.mockResolvedValue([{ ...job, attempts: 8 }]);
    mocks.send.mockRejectedValue(new OneSignalProviderError('timeout', true));
    await notificationService.processOutboxJobs();
    expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DEAD', attempts: 8 }) }));
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it('cancels a job whose jornada was deleted without calling OneSignal', async () => {
    mocks.queryRaw.mockResolvedValue([{ ...job, jornadaId: null }]);
    await notificationService.processOutboxJobs();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });

  it('marks an empty audience sent without calling OneSignal', async () => {
    mocks.ownerFindMany.mockResolvedValue([]);
    await notificationService.processOutboxJobs();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }));
  });

  it('isolates jobs so one provider failure does not stop the batch', async () => {
    mocks.queryRaw.mockResolvedValue([job, { ...job, id: 'job-2', providerIdempotencyKey: 'key-2' }]);
    mocks.send.mockRejectedValueOnce(new OneSignalProviderError('network_error', true)).mockResolvedValueOnce(undefined);
    await notificationService.processOutboxJobs();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.outboxUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'job-2' }), data: expect.objectContaining({ status: 'SENT' }) }));
  });

  it('claims with skip locked and a bounded lease', async () => {
    await notificationService.claimJobs('worker-1', 5);
    const sql = mocks.queryRaw.mock.calls.at(-1)?.[0].join(' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("INTERVAL '60 seconds'");
    expect(sql).toContain("status = 'PROCESSING'");
    expect(sql).toContain('"aggregationKey" = NULL');
  });

  it('sends a grouped schedule change only to stored affected owners', async () => {
    mocks.queryRaw.mockResolvedValue([{
      ...job,
      jornadaId: null,
      eventType: 'SCHEDULE_CHANGED',
      payload: { jornadaIds: ['jornada-1', 'jornada-2'], partidoIds: ['partido-1'] },
      targetUserIds: ['owner-2', 'owner-1', 'owner-1'],
    }]);

    await notificationService.processOutboxJobs();

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      headings: { en: 'Tu programación fue actualizada', es: 'Tu programación fue actualizada' },
      include_aliases: { external_id: ['owner-2', 'owner-1'] },
      data: expect.objectContaining({
        type: 'schedule_changed',
        divisionId: 'division-1',
        ligaId: 'liga-1',
        jornadaIds: ['jornada-1', 'jornada-2'],
        partidoIds: ['partido-1'],
      }),
    }), 'stable-provider-key');
    expect(mocks.ownerFindMany).not.toHaveBeenCalled();
    expect(mocks.followerFindMany).not.toHaveBeenCalled();
  });

  it('cancels a schedule change when its division was deleted', async () => {
    mocks.queryRaw.mockResolvedValue([{
      ...job,
      jornadaId: null,
      eventType: 'SCHEDULE_CHANGED',
      payload: {},
      targetUserIds: ['owner-1'],
    }]);
    mocks.divisionFindUnique.mockResolvedValue(null);

    await notificationService.processOutboxJobs();

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', aggregationKey: null }),
    }));
  });
});

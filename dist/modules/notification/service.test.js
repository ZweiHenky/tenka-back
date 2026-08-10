"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    queryRaw: vitest_1.vi.fn(),
    outboxUpdateMany: vitest_1.vi.fn(),
    jornadaFindUnique: vitest_1.vi.fn(),
    divisionFindUnique: vitest_1.vi.fn(),
    ownerFindMany: vitest_1.vi.fn(),
    followerFindMany: vitest_1.vi.fn(),
    send: vitest_1.vi.fn(),
    capture: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $queryRaw: mocks.queryRaw,
        notificationOutbox: { updateMany: mocks.outboxUpdateMany },
        jornada: { findUnique: mocks.jornadaFindUnique },
        division: { findUnique: mocks.divisionFindUnique },
        divisionEquipo: { findMany: mocks.ownerFindMany },
        divisionNotificationSubscription: { findMany: mocks.followerFindMany },
    },
}));
vitest_1.vi.mock('../notification-subscription/onesignal-client', async (original) => ({
    ...(await original()),
    sendNotification: mocks.send,
}));
vitest_1.vi.mock('../../instrument', () => ({ Sentry: { captureException: mocks.capture } }));
vitest_1.vi.mock('../../config/logger', () => ({ logger: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn() } }));
const onesignal_client_1 = require("../notification-subscription/onesignal-client");
const service_1 = require("./service");
const job = {
    id: 'job-1', jornadaId: 'jornada-1', divisionId: 'division-1', audience: 'REGISTERED',
    eventType: 'JORNADA_GENERATED', payload: null, targetUserIds: null,
    providerIdempotencyKey: 'stable-provider-key', attempts: 1, maxAttempts: 8,
};
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
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
(0, vitest_1.describe)('notification outbox worker', () => {
    (0, vitest_1.it)('sends once with unique owners and the stable provider key, then completes conditionally', async () => {
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ include_aliases: { external_id: ['owner-1'] } }), 'stable-provider-key');
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'job-1', status: 'PROCESSING', lockedBy: vitest_1.expect.any(String) }),
            data: vitest_1.expect.objectContaining({ status: 'SENT', lockedBy: null, leaseUntil: null }),
        }));
    });
    (0, vitest_1.it)('honors a transient 429 retry and does not report it to Sentry', async () => {
        mocks.send.mockRejectedValue(new onesignal_client_1.OneSignalProviderError('http_429', true, 120000, 429));
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ status: 'PENDING', attempts: 1, lastErrorCode: 'http_429', nextAttemptAt: vitest_1.expect.any(Date) }),
        }));
        (0, vitest_1.expect)(mocks.capture).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('marks the eighth transient attempt dead and captures exactly once', async () => {
        mocks.queryRaw.mockResolvedValue([{ ...job, attempts: 8 }]);
        mocks.send.mockRejectedValue(new onesignal_client_1.OneSignalProviderError('timeout', true));
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'DEAD', attempts: 8 }) }));
        (0, vitest_1.expect)(mocks.capture).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('cancels a job whose jornada was deleted without calling OneSignal', async () => {
        mocks.queryRaw.mockResolvedValue([{ ...job, jornadaId: null }]);
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'CANCELLED' }) }));
    });
    (0, vitest_1.it)('marks an empty audience sent without calling OneSignal', async () => {
        mocks.ownerFindMany.mockResolvedValue([]);
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ data: vitest_1.expect.objectContaining({ status: 'SENT' }) }));
    });
    (0, vitest_1.it)('isolates jobs so one provider failure does not stop the batch', async () => {
        mocks.queryRaw.mockResolvedValue([job, { ...job, id: 'job-2', providerIdempotencyKey: 'key-2' }]);
        mocks.send.mockRejectedValueOnce(new onesignal_client_1.OneSignalProviderError('network_error', true)).mockResolvedValueOnce(undefined);
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: vitest_1.expect.objectContaining({ id: 'job-2' }), data: vitest_1.expect.objectContaining({ status: 'SENT' }) }));
    });
    (0, vitest_1.it)('claims with skip locked and a bounded lease', async () => {
        await service_1.notificationService.claimJobs('worker-1', 5);
        const sql = mocks.queryRaw.mock.calls.at(-1)?.[0].join(' ');
        (0, vitest_1.expect)(sql).toContain('FOR UPDATE SKIP LOCKED');
        (0, vitest_1.expect)(sql).toContain("INTERVAL '60 seconds'");
        (0, vitest_1.expect)(sql).toContain("status = 'PROCESSING'");
        (0, vitest_1.expect)(sql).toContain('"aggregationKey" = NULL');
    });
    (0, vitest_1.it)('sends a grouped schedule change only to stored affected owners', async () => {
        mocks.queryRaw.mockResolvedValue([{
                ...job,
                jornadaId: null,
                eventType: 'SCHEDULE_CHANGED',
                payload: { jornadaIds: ['jornada-1', 'jornada-2'], partidoIds: ['partido-1'] },
                targetUserIds: ['owner-2', 'owner-1', 'owner-1'],
            }]);
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            headings: { en: 'Tu programación fue actualizada', es: 'Tu programación fue actualizada' },
            include_aliases: { external_id: ['owner-2', 'owner-1'] },
            data: vitest_1.expect.objectContaining({
                type: 'schedule_changed',
                divisionId: 'division-1',
                ligaId: 'liga-1',
                jornadaIds: ['jornada-1', 'jornada-2'],
                partidoIds: ['partido-1'],
            }),
        }), 'stable-provider-key');
        (0, vitest_1.expect)(mocks.ownerFindMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.followerFindMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('cancels a schedule change when its division was deleted', async () => {
        mocks.queryRaw.mockResolvedValue([{
                ...job,
                jornadaId: null,
                eventType: 'SCHEDULE_CHANGED',
                payload: {},
                targetUserIds: ['owner-1'],
            }]);
        mocks.divisionFindUnique.mockResolvedValue(null);
        await service_1.notificationService.processOutboxJobs();
        (0, vitest_1.expect)(mocks.send).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.outboxUpdateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            data: vitest_1.expect.objectContaining({ status: 'CANCELLED', aggregationKey: null }),
        }));
    });
});
//# sourceMappingURL=service.test.js.map
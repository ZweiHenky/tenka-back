"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    transaction: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    divisionFindMany: vitest_1.vi.fn(),
    subscriptionUpsert: vitest_1.vi.fn(),
    subscriptionDeleteMany: vitest_1.vi.fn(),
    subscriptionCreateMany: vitest_1.vi.fn(),
    subscriptionFindMany: vitest_1.vi.fn(),
}));
const tx = {
    division: { findFirst: mocks.divisionFindFirst, findMany: mocks.divisionFindMany },
    divisionNotificationSubscription: {
        upsert: mocks.subscriptionUpsert,
        deleteMany: mocks.subscriptionDeleteMany,
        createMany: mocks.subscriptionCreateMany,
        findMany: mocks.subscriptionFindMany,
    },
};
vitest_1.vi.mock('../../config/database', () => ({ prisma: {
        $transaction: mocks.transaction,
        divisionNotificationSubscription: { deleteMany: mocks.subscriptionDeleteMany },
    } }));
const controller_1 = require("./controller");
const service_1 = require("./service");
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    mocks.divisionFindMany.mockResolvedValue([{ id: 'division-1' }, { id: 'division-2' }]);
    mocks.subscriptionUpsert.mockResolvedValue({ id: 'subscription-1' });
    mocks.subscriptionDeleteMany.mockResolvedValue({ count: 1 });
    mocks.subscriptionCreateMany.mockResolvedValue({ count: 2 });
    mocks.subscriptionFindMany.mockResolvedValue([]);
});
(0, vitest_1.describe)('notification subscriptions by device', () => {
    (0, vitest_1.it)('transactionally replaces one device rows with a deduplicated canonical set', async () => {
        const canonical = [
            { divisionId: 'division-1', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
            { divisionId: 'division-2', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
        ];
        mocks.subscriptionFindMany.mockResolvedValue(canonical);
        await (0, vitest_1.expect)(service_1.notificationSubscriptionService.sync({
            divisionIds: ['division-2', 'division-1', 'division-2'],
            oneSignalId: 'one-new',
            pushSubscriptionId: 'push-new',
            userId: 'user-1',
        })).resolves.toEqual(canonical);
        (0, vitest_1.expect)(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({ where: { pushSubscriptionId: 'push-new' } });
        (0, vitest_1.expect)(mocks.subscriptionCreateMany).toHaveBeenCalledWith({ data: [
                { divisionId: 'division-1', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
                { divisionId: 'division-2', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
            ] });
    });
    (0, vitest_1.it)('clears all device follows for an empty complete set and returns canonical state', async () => {
        await (0, vitest_1.expect)(service_1.notificationSubscriptionService.sync({
            divisionIds: [], oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: null,
        })).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.divisionFindMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.subscriptionCreateMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.subscriptionFindMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { oneSignalId: 'one-1', pushSubscriptionId: 'push-1' },
        }));
    });
    (0, vitest_1.it)('rejects the entire sync when any requested division is missing or draft', async () => {
        mocks.divisionFindMany.mockResolvedValueOnce([{ id: 'division-1' }]);
        await (0, vitest_1.expect)(service_1.notificationSubscriptionService.sync({
            divisionIds: ['division-1', 'draft-division'], oneSignalId: 'one-1', pushSubscriptionId: 'push-1',
        })).rejects.toThrow('Division no encontrado');
        (0, vitest_1.expect)(mocks.subscriptionDeleteMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('retries a concurrent serializable reconciliation conflict', async () => {
        mocks.divisionFindMany.mockResolvedValueOnce([{ id: 'division-1' }]);
        mocks.transaction
            .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
            .mockImplementationOnce((callback) => callback(tx));
        await service_1.notificationSubscriptionService.sync({
            divisionIds: ['division-1'], oneSignalId: 'one-1', pushSubscriptionId: 'push-1',
        });
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('sets the current user to null when a legacy subscribe is anonymous', async () => {
        await service_1.notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: null });
        (0, vitest_1.expect)(mocks.subscriptionUpsert).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            update: vitest_1.expect.objectContaining({ userId: null }),
        }));
    });
    (0, vitest_1.it)('atomically subscribes with the device identity and authenticated user', async () => {
        await service_1.notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' });
        (0, vitest_1.expect)(mocks.subscriptionUpsert).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { divisionId_pushSubscriptionId: { divisionId: 'division-1', pushSubscriptionId: 'push-1' } },
            create: vitest_1.expect.objectContaining({ userId: 'user-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' }),
            update: vitest_1.expect.objectContaining({ oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' }),
        }));
    });
    (0, vitest_1.it)('updates the OneSignal user identity for an existing push subscription', async () => {
        await service_1.notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-2' });
        (0, vitest_1.expect)(mocks.subscriptionUpsert).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { divisionId_pushSubscriptionId: { divisionId: 'division-1', pushSubscriptionId: 'push-2' } },
            update: vitest_1.expect.objectContaining({ oneSignalId: 'one-1', pushSubscriptionId: 'push-2' }),
        }));
    });
    (0, vitest_1.it)('uses idempotent device deleteMany and does not swallow failures', async () => {
        await service_1.notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' });
        (0, vitest_1.expect)(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({
            where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' },
        });
        const failure = new Error('database unavailable');
        mocks.subscriptionDeleteMany.mockRejectedValueOnce(failure);
        await (0, vitest_1.expect)(service_1.notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' })).rejects.toBe(failure);
    });
    (0, vitest_1.it)('keeps legacy unsubscribe requests scoped to their push subscription id', async () => {
        await service_1.notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' });
        (0, vitest_1.expect)(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({
            where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' },
        });
    });
    vitest_1.it.each([
        { divisionId: '', oneSignalId: 'id' },
        { divisionId: 'division', oneSignalId: '   ' },
        { divisionId: 'division', oneSignalId: 'id', pushSubscriptionId: '' },
        { divisionId: 'division', oneSignalId: 'x'.repeat(201) },
    ])('rejects empty or oversized provider identifiers: %j', (value) => {
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.subscribeSchema.safeParse(value).success).toBe(false);
    });
    (0, vitest_1.it)('validates a provided OneSignal id while accepting legacy unsubscribe clients', () => {
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', oneSignalId: '', pushSubscriptionId: 'push' }).success).toBe(false);
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', pushSubscriptionId: 'push' }).success).toBe(true);
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', oneSignalId: 'one', pushSubscriptionId: 'push' }).success).toBe(true);
    });
    (0, vitest_1.it)('caps batch sync cardinality and validates all identifiers', () => {
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: [] }).success).toBe(true);
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: Array(101).fill('division') }).success).toBe(false);
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: [''] }).success).toBe(false);
    });
});
//# sourceMappingURL=service.test.js.map
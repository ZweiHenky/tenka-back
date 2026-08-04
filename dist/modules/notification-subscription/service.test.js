"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    transaction: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    subscriptionUpsert: vitest_1.vi.fn(),
    subscriptionDeleteMany: vitest_1.vi.fn(),
}));
const tx = {
    division: { findFirst: mocks.divisionFindFirst },
    divisionNotificationSubscription: {
        upsert: mocks.subscriptionUpsert,
        deleteMany: mocks.subscriptionDeleteMany,
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
    mocks.subscriptionUpsert.mockResolvedValue({ id: 'subscription-1' });
    mocks.subscriptionDeleteMany.mockResolvedValue({ count: 1 });
});
(0, vitest_1.describe)('notification subscriptions by device', () => {
    (0, vitest_1.it)('atomically subscribes with the device identity and authenticated user', async () => {
        await service_1.notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' });
        (0, vitest_1.expect)(mocks.subscriptionUpsert).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { divisionId_pushSubscriptionId: { divisionId: 'division-1', pushSubscriptionId: 'push-1' } },
            create: vitest_1.expect.objectContaining({ userId: 'user-1', pushSubscriptionId: 'push-1' }),
        }));
    });
    (0, vitest_1.it)('uses idempotent device deleteMany and does not swallow failures', async () => {
        await service_1.notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' });
        (0, vitest_1.expect)(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' } });
        const failure = new Error('database unavailable');
        mocks.subscriptionDeleteMany.mockRejectedValueOnce(failure);
        await (0, vitest_1.expect)(service_1.notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' })).rejects.toBe(failure);
    });
    vitest_1.it.each([
        { divisionId: '', oneSignalId: 'id' },
        { divisionId: 'division', oneSignalId: '   ' },
        { divisionId: 'division', oneSignalId: 'id', pushSubscriptionId: '' },
        { divisionId: 'division', oneSignalId: 'x'.repeat(201) },
    ])('rejects empty or oversized provider identifiers: %j', (value) => {
        (0, vitest_1.expect)(controller_1.notificationSubscriptionSchemas.subscribeSchema.safeParse(value).success).toBe(false);
    });
});
//# sourceMappingURL=service.test.js.map
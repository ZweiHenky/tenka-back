import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  divisionFindFirst: vi.fn(),
  divisionFindMany: vi.fn(),
  subscriptionUpsert: vi.fn(),
  subscriptionDeleteMany: vi.fn(),
  subscriptionCreateMany: vi.fn(),
  subscriptionFindMany: vi.fn(),
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

vi.mock('../../config/database', () => ({ prisma: {
  $transaction: mocks.transaction,
  divisionNotificationSubscription: { deleteMany: mocks.subscriptionDeleteMany },
} }));

import { notificationSubscriptionSchemas } from './controller';
import { notificationSubscriptionService } from './service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((callback) => callback(tx));
  mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
  mocks.divisionFindMany.mockResolvedValue([{ id: 'division-1' }, { id: 'division-2' }]);
  mocks.subscriptionUpsert.mockResolvedValue({ id: 'subscription-1' });
  mocks.subscriptionDeleteMany.mockResolvedValue({ count: 1 });
  mocks.subscriptionCreateMany.mockResolvedValue({ count: 2 });
  mocks.subscriptionFindMany.mockResolvedValue([]);
});

describe('notification subscriptions by device', () => {
  it('transactionally replaces one device rows with a deduplicated canonical set', async () => {
    const canonical = [
      { divisionId: 'division-1', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
      { divisionId: 'division-2', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
    ];
    mocks.subscriptionFindMany.mockResolvedValue(canonical);

    await expect(notificationSubscriptionService.sync({
      divisionIds: ['division-2', 'division-1', 'division-2'],
      oneSignalId: 'one-new',
      pushSubscriptionId: 'push-new',
      userId: 'user-1',
    })).resolves.toEqual(canonical);

    expect(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({ where: { pushSubscriptionId: 'push-new' } });
    expect(mocks.subscriptionCreateMany).toHaveBeenCalledWith({ data: [
      { divisionId: 'division-1', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
      { divisionId: 'division-2', oneSignalId: 'one-new', pushSubscriptionId: 'push-new', userId: 'user-1' },
    ] });
  });

  it('clears all device follows for an empty complete set and returns canonical state', async () => {
    await expect(notificationSubscriptionService.sync({
      divisionIds: [], oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: null,
    })).resolves.toEqual([]);

    expect(mocks.divisionFindMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { oneSignalId: 'one-1', pushSubscriptionId: 'push-1' },
    }));
  });

  it('rejects the entire sync when any requested division is missing or draft', async () => {
    mocks.divisionFindMany.mockResolvedValueOnce([{ id: 'division-1' }]);

    await expect(notificationSubscriptionService.sync({
      divisionIds: ['division-1', 'draft-division'], oneSignalId: 'one-1', pushSubscriptionId: 'push-1',
    })).rejects.toThrow('Division no encontrado');
    expect(mocks.subscriptionDeleteMany).not.toHaveBeenCalled();
  });

  it('retries a concurrent serializable reconciliation conflict', async () => {
    mocks.divisionFindMany.mockResolvedValueOnce([{ id: 'division-1' }]);
    mocks.transaction
      .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
      .mockImplementationOnce((callback) => callback(tx));

    await notificationSubscriptionService.sync({
      divisionIds: ['division-1'], oneSignalId: 'one-1', pushSubscriptionId: 'push-1',
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it('sets the current user to null when a legacy subscribe is anonymous', async () => {
    await notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: null });
    expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ userId: null }),
    }));
  });

  it('atomically subscribes with the device identity and authenticated user', async () => {
    await notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' });
    expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId_pushSubscriptionId: { divisionId: 'division-1', pushSubscriptionId: 'push-1' } },
      create: expect.objectContaining({ userId: 'user-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' }),
      update: expect.objectContaining({ oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' }),
    }));
  });

  it('updates the OneSignal user identity for an existing push subscription', async () => {
    await notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-2' });
    expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId_pushSubscriptionId: { divisionId: 'division-1', pushSubscriptionId: 'push-2' } },
      update: expect.objectContaining({ oneSignalId: 'one-1', pushSubscriptionId: 'push-2' }),
    }));
  });

  it('uses idempotent device deleteMany and does not swallow failures', async () => {
    await notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' });
    expect(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' },
    });

    const failure = new Error('database unavailable');
    mocks.subscriptionDeleteMany.mockRejectedValueOnce(failure);
    await expect(notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' })).rejects.toBe(failure);
  });

  it('keeps legacy unsubscribe requests scoped to their push subscription id', async () => {
    await notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' });

    expect(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' },
    });
  });

  it.each([
    { divisionId: '', oneSignalId: 'id' },
    { divisionId: 'division', oneSignalId: '   ' },
    { divisionId: 'division', oneSignalId: 'id', pushSubscriptionId: '' },
    { divisionId: 'division', oneSignalId: 'x'.repeat(201) },
  ])('rejects empty or oversized provider identifiers: %j', (value) => {
    expect(notificationSubscriptionSchemas.subscribeSchema.safeParse(value).success).toBe(false);
  });

  it('validates a provided OneSignal id while accepting legacy unsubscribe clients', () => {
    expect(notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', oneSignalId: '', pushSubscriptionId: 'push' }).success).toBe(false);
    expect(notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', pushSubscriptionId: 'push' }).success).toBe(true);
    expect(notificationSubscriptionSchemas.unsubscribeSchema.safeParse({ divisionId: 'division', oneSignalId: 'one', pushSubscriptionId: 'push' }).success).toBe(true);
  });

  it('caps batch sync cardinality and validates all identifiers', () => {
    expect(notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: [] }).success).toBe(true);
    expect(notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: Array(101).fill('division') }).success).toBe(false);
    expect(notificationSubscriptionSchemas.syncSchema.safeParse({ oneSignalId: 'one', pushSubscriptionId: 'push', divisionIds: [''] }).success).toBe(false);
  });
});

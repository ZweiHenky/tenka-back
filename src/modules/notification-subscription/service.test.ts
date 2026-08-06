import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  divisionFindFirst: vi.fn(),
  subscriptionUpsert: vi.fn(),
  subscriptionDeleteMany: vi.fn(),
}));

const tx = {
  division: { findFirst: mocks.divisionFindFirst },
  divisionNotificationSubscription: {
    upsert: mocks.subscriptionUpsert,
    deleteMany: mocks.subscriptionDeleteMany,
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
  mocks.subscriptionUpsert.mockResolvedValue({ id: 'subscription-1' });
  mocks.subscriptionDeleteMany.mockResolvedValue({ count: 1 });
});

describe('notification subscriptions by device', () => {
  it('atomically subscribes with the device identity and authenticated user', async () => {
    await notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1', userId: 'user-1' });
    expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId_oneSignalId: { divisionId: 'division-1', oneSignalId: 'one-1' } },
      create: expect.objectContaining({ userId: 'user-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-1' }),
      update: expect.objectContaining({ pushSubscriptionId: 'push-1', userId: 'user-1' }),
    }));
  });

  it('updates the push subscription id when the same device resubscribes with a rotated id', async () => {
    await notificationSubscriptionService.subscribe({ divisionId: 'division-1', oneSignalId: 'one-1', pushSubscriptionId: 'push-2' });
    expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId_oneSignalId: { divisionId: 'division-1', oneSignalId: 'one-1' } },
      update: expect.objectContaining({ pushSubscriptionId: 'push-2' }),
    }));
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { divisionId_pushSubscriptionId: expect.anything() },
    }));
  });

  it('uses idempotent device deleteMany and does not swallow failures', async () => {
    await notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' });
    expect(mocks.subscriptionDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1', pushSubscriptionId: 'push-1' } });

    const failure = new Error('database unavailable');
    mocks.subscriptionDeleteMany.mockRejectedValueOnce(failure);
    await expect(notificationSubscriptionService.unsubscribe({ divisionId: 'division-1', pushSubscriptionId: 'push-1' })).rejects.toBe(failure);
  });

  it.each([
    { divisionId: '', oneSignalId: 'id' },
    { divisionId: 'division', oneSignalId: '   ' },
    { divisionId: 'division', oneSignalId: 'id', pushSubscriptionId: '' },
    { divisionId: 'division', oneSignalId: 'x'.repeat(201) },
  ])('rejects empty or oversized provider identifiers: %j', (value) => {
    expect(notificationSubscriptionSchemas.subscribeSchema.safeParse(value).success).toBe(false);
  });
});

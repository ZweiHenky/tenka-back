import { prisma } from '../../config/database';
import { NotFoundError } from '../../utils/errors';

type SubscriptionInput = {
  divisionId: string;
  oneSignalId: string;
  pushSubscriptionId: string;
  userId?: string | null;
};

export const notificationSubscriptionService = {
  async subscribe(data: SubscriptionInput) {
    return prisma.$transaction(async (tx) => {
      const division = await tx.division.findFirst({
        where: { id: data.divisionId, estadoLiga: { nombre: { not: 'Borrador' } } },
        select: { id: true },
      });
      if (!division) throw new NotFoundError('Division');

      const subscription = await tx.divisionNotificationSubscription.upsert({
        where: { divisionId_pushSubscriptionId: { divisionId: data.divisionId, pushSubscriptionId: data.pushSubscriptionId } },
        create: {
          divisionId: data.divisionId,
          oneSignalId: data.oneSignalId,
          pushSubscriptionId: data.pushSubscriptionId,
          userId: data.userId ?? null,
        },
        update: {
          oneSignalId: data.oneSignalId,
          ...(data.userId ? { userId: data.userId } : {}),
        },
      });
      return subscription;
    });
  },

  async unsubscribe(data: Pick<SubscriptionInput, 'divisionId' | 'pushSubscriptionId'>) {
    await prisma.divisionNotificationSubscription.deleteMany({
      where: { divisionId: data.divisionId, pushSubscriptionId: data.pushSubscriptionId },
    });
  },
};

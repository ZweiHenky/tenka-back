import { prisma } from '../../config/database';
import { NotFoundError } from '../../utils/errors';

export const notificationSubscriptionService = {
  async subscribe(data: { divisionId: string; oneSignalId: string; pushSubscriptionId?: string | null }) {
    const division = await prisma.division.findFirst({
      where: { id: data.divisionId, estadoLiga: { nombre: { not: 'Borrador' } } },
      select: { id: true },
    });
    if (!division) throw new NotFoundError('Division');

    return prisma.divisionNotificationSubscription.upsert({
      where: {
        divisionId_oneSignalId: { divisionId: data.divisionId, oneSignalId: data.oneSignalId },
      },
      create: {
        divisionId: data.divisionId,
        oneSignalId: data.oneSignalId,
        pushSubscriptionId: data.pushSubscriptionId ?? null,
      },
      update: {
        oneSignalId: data.oneSignalId,
        pushSubscriptionId: data.pushSubscriptionId ?? null,
      },
    });
  },

  async unsubscribe(data: { divisionId: string; oneSignalId: string }) {
    try {
      await prisma.divisionNotificationSubscription.delete({
        where: {
          divisionId_oneSignalId: { divisionId: data.divisionId, oneSignalId: data.oneSignalId },
        },
      });
    } catch {
      // ignore if not found
    }
  },
};

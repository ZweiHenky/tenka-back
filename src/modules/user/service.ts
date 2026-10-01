import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { mediaService } from '../media/service';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { detachBillingAccount, ensureBillingAccount } from '../billing/service';

const sanitizedUserSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  image: true,
  phoneNumber: true,
  phoneNumberVerified: true,
  showPhoneInPublicLeague: true,
  rol: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const userService = {
  async activateLeagueRole(userId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: userId, rol: 'CAPITAN' },
        data: { rol: 'LIGA' },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: sanitizedUserSelect,
      });
      if (!user) throw new NotFoundError('Usuario');
      if (user.rol === 'LIGA') await ensureBillingAccount(tx, userId);

      return user;
    });
  },

  async deleteAccount(userId: string, email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, image: true, imagePublicId: true },
    });
    if (!user) throw new NotFoundError('Usuario');
    if (user.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      throw new ValidationError('El correo no coincide. Escribe el correo de tu cuenta para confirmar.');
    }

    await prisma.$transaction(async (tx) => {
      await detachBillingAccount(tx, userId);

      const ligas = await tx.liga.findMany({
        where: { userId },
        select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
      });
      for (const liga of ligas) {
        await mediaService.scheduleImageCleanup(liga.logo, liga.logoPublicId, tx);
        await mediaService.scheduleImageCleanup(liga.cancha, liga.canchaPublicId, tx);
      }
      await tx.liga.deleteMany({ where: { userId } });

      const equipos = await tx.equipo.findMany({
        where: { userId },
        select: { logo: true, logoPublicId: true },
      });
      for (const equipo of equipos) {
        await mediaService.scheduleImageCleanup(equipo.logo, equipo.logoPublicId, tx);
      }
      await tx.equipo.deleteMany({ where: { userId } });

      const jugador = await tx.jugador.findFirst({
        where: { userId },
        select: { id: true, foto: true, fotoPublicId: true },
      });
      if (jugador) {
        await mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId, tx);
        await tx.jugador.delete({ where: { id: jugador.id } });
      }

      await tx.partidoRefereeAccess.deleteMany({ where: { createdById: userId } });

      const subscriptions = await tx.divisionNotificationSubscription.findMany({
        where: { userId },
        select: { oneSignalId: true, divisionId: true },
      });
      for (const subscription of subscriptions) {
        const tag = `division_${subscription.divisionId}`;
        await tx.oneSignalTagCleanupJob.upsert({
          where: { oneSignalId_tag: { oneSignalId: subscription.oneSignalId, tag } },
          create: { oneSignalId: subscription.oneSignalId, tag, desired: false },
          update: { desired: false, status: 'PENDING', attempts: 0, lastError: null, deadAt: null, leaseUntil: null, lockedBy: null, nextTryAt: new Date() },
        });
      }
      await tx.divisionNotificationSubscription.deleteMany({ where: { userId } });

      const mediaAssets = await tx.mediaAsset.findMany({
        where: { ownerId: userId, status: { in: ['PENDING', 'UPLOADED', 'ATTACHED'] } },
        select: { publicId: true },
      });
      for (const asset of mediaAssets) {
        await mediaService.scheduleDeletion(asset.publicId, tx);
      }

      await mediaService.scheduleImageCleanup(user.image, user.imagePublicId, tx);
      await tx.user.delete({ where: { id: userId } });
    });
    signalBackgroundJob('media-deletion');
    signalBackgroundJob('tag-cleanup');
  },
};

import { prisma } from '../../config/database';
import { NotFoundError } from '../../utils/errors';

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
    await prisma.user.updateMany({
      where: { id: userId, rol: 'CAPITAN' },
      data: { rol: 'LIGA' },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: sanitizedUserSelect,
    });
    if (!user) throw new NotFoundError('Usuario');

    return user;
  },
};

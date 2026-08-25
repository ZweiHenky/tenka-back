import { prisma } from '../../config/database';
import type { WaitlistRepository } from './repository.interface';

export const waitlistRepository: WaitlistRepository = {
  async create(data) {
    await prisma.waitlistEntry.createMany({
      data: [data],
      skipDuplicates: true,
    });
  },
};

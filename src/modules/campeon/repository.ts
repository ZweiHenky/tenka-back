import { prisma } from '../../config/database';
import type { CampeonEntity, CampeonWriteData } from './entity';
import type { CampeonRepository } from './repository.interface';
import type { AuthenticatedUser } from '../../types/auth';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';

export const campeonRepository: CampeonRepository = {
  async findVisibleByDivision(divisionId: string, actor?: AuthenticatedUser) {
    return prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: { campeon: true },
    });
  },

  async upsert(divisionId: string, data: CampeonWriteData): Promise<CampeonEntity> {
    return prisma.divisionCampeon.upsert({
      where: { divisionId },
      create: { divisionId, ...data },
      update: data,
    });
  },

  async deleteByDivision(divisionId: string): Promise<void> {
    await prisma.divisionCampeon.deleteMany({ where: { divisionId } });
  },
};

import type { DivisionEquipoEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import type { Prisma } from '../../generated/prisma/client';

export interface DivisionEquipoRepository {
  findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[] | null>;
  findByEquipo(equipoId: string, actor?: AuthenticatedUser): Promise<DivisionEquipoEntity[]>;
  create(data: { divisionId: string; equipoId: string }, tx?: Prisma.TransactionClient): Promise<DivisionEquipoEntity>;
  updateSaldoPendiente(divisionId: string, equipoId: string, saldoPendiente: string, actor: AuthenticatedUser): Promise<boolean>;
  delete(divisionId: string, equipoId: string, tx?: Prisma.TransactionClient): Promise<void>;
}

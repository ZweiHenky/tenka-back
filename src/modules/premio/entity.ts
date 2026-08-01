import type { Prisma } from '../../generated/prisma/client';

export interface PremioEntity {
  id: string;
  posicion: number;
  titulo: string;
  monto: Prisma.Decimal | null;
  descripcion: string | null;
  createdAt: Date;
  updatedAt: Date;
  divisionId: string;
}

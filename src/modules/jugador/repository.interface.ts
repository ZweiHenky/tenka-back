import type { Prisma } from '../../generated/prisma/client';

export type DivisionRosterEntry = Prisma.DivisionJugadorGetPayload<{
  include: { jugador: true };
}>;

export interface JugadorRepository {
  findDivisionTeamOwner(
    divisionId: string,
    equipoId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string | null>;
  findTeamPlayer(
    equipoId: string,
    jugadorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ jugadorId: string; dorsal: number } | null>;
  createDivisionRosterEntry(
    data: { divisionId: string; equipoId: string; jugadorId: string; dorsal: number },
    tx: Prisma.TransactionClient,
  ): Promise<DivisionRosterEntry>;
  deleteDivisionRosterEntry(
    divisionId: string,
    equipoId: string,
    jugadorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}

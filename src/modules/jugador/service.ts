import { prisma } from '../../config/database';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../types/auth';
import { isAdmin } from '../../utils/authorization';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { observeResourceAccessShadowInTransaction } from '../billing/resourceAccessShadow';
import { jugadorRepository } from './repository';

async function assertCanManageDivisionRoster(
  divisionId: string,
  equipoId: string,
  actor: AuthenticatedUser,
  tx: Prisma.TransactionClient,
) {
  const ownerId = await jugadorRepository.findDivisionTeamOwner(divisionId, equipoId, tx);
  if (!ownerId || (!isAdmin(actor) && ownerId !== actor.id)) {
    throw new NotFoundError('Equipo en división');
  }
}

export const jugadorService = {
  async assignToDivision(
    data: { divisionId: string; equipoId: string; jugadorId: string },
    actor: AuthenticatedUser,
  ) {
    return prisma.$transaction(async (tx) => {
      await assertCanManageDivisionRoster(data.divisionId, data.equipoId, actor, tx);
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'division-roster.assign', capability: 'MANAGE_DIVISION', actor,
        divisionId: data.divisionId, resourceType: 'DIVISION',
      });

      const teamPlayer = await jugadorRepository.findTeamPlayer(data.equipoId, data.jugadorId, tx);
      if (!teamPlayer) throw new ValidationError('El jugador debe pertenecer al equipo');
      return jugadorRepository.createDivisionRosterEntry({ ...data, dorsal: teamPlayer.dorsal }, tx);
    });
  },

  async removeFromDivision(
    divisionId: string,
    equipoId: string,
    jugadorId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await assertCanManageDivisionRoster(divisionId, equipoId, actor, tx);
      await observeResourceAccessShadowInTransaction(tx, {
        operation: 'division-roster.remove', capability: 'MANAGE_DIVISION', actor,
        divisionId, resourceType: 'DIVISION',
      });
      await jugadorRepository.deleteDivisionRosterEntry(divisionId, equipoId, jugadorId, tx);
    });
  },
};

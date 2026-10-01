import type { JugadorRepository } from './repository.interface';

export const jugadorRepository: JugadorRepository = {
  async findDivisionTeamOwner(divisionId, equipoId, tx) {
    const membership = await tx.divisionEquipo.findUnique({
      where: { divisionId_equipoId: { divisionId, equipoId } },
      select: { division: { select: { liga: { select: { userId: true } } } } },
    });
    return membership?.division.liga.userId ?? null;
  },

  async findTeamPlayer(equipoId, jugadorId, tx) {
    return tx.equipoJugador.findUnique({
      where: { equipoId_jugadorId: { equipoId, jugadorId } },
      select: { jugadorId: true, dorsal: true },
    });
  },

  async createDivisionRosterEntry(data, tx) {
    return tx.divisionJugador.create({ data, include: { jugador: true } });
  },

  async deleteDivisionRosterEntry(divisionId, equipoId, jugadorId, tx) {
    await tx.divisionJugador.delete({
      where: { divisionId_equipoId_jugadorId: { divisionId, equipoId, jugadorId } },
    });
  },
};

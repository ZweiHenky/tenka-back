import { prisma } from '../../config/database'
import type { AuthenticatedUser } from '../../types/auth'
import { NotFoundError } from '../../utils/errors'
import { visibleDivisionWhere } from '../../utils/divisionVisibility'

export const goleadoresService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser) {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: { id: true },
    })
    if (!division) throw new NotFoundError('División')

    const allocations = await prisma.anotacionPartido.findMany({
      where: {
        partido: {
          estado: 'FINALIZADO',
          OR: [{ jornada: { divisionId } }, { rondaPlayoff: { divisionId } }],
        },
      },
      select: {
        jugadorId: true,
        jugadorIdSnapshot: true,
        equipoId: true,
        equipoIdSnapshot: true,
        ladoMarcador: true,
        cantidad: true,
        jugadorNombre: true,
        equipoNombre: true,
        jugador: { select: { nombre: true, foto: true } },
        equipo: { select: { nombre: true } },
        partido: { select: { tipoPartido: true } },
      },
    })

    const eligible = allocations.filter((allocation) => allocation.partido.tipoPartido !== 'AMISTOSO'
      && (allocation.partido.tipoPartido !== 'COMPLEMENTO' || allocation.ladoMarcador === 'LOCAL'))
    const unattributedGoals = eligible
      .filter((allocation) => !allocation.jugadorId && !allocation.jugadorNombre)
      .reduce((sum, allocation) => sum + allocation.cantidad, 0)
    const players = new Map<string, {
      jugadorId: string | null
      nombre: string
      foto: string | null
      goles: number
      equipos: Map<string, { equipoId: string | null; nombre: string; goles: number }>
    }>()

    for (const allocation of eligible) {
      if (!allocation.jugadorId && !allocation.jugadorNombre) continue
      const stablePlayerId = allocation.jugadorId ?? allocation.jugadorIdSnapshot
      const playerKey = stablePlayerId ?? `snapshot:${allocation.jugadorNombre}`
      let player = players.get(playerKey)
      if (!player) {
        player = {
          jugadorId: stablePlayerId,
          nombre: allocation.jugador?.nombre ?? allocation.jugadorNombre ?? 'Jugador eliminado',
          foto: allocation.jugador?.foto ?? null,
          goles: 0,
          equipos: new Map(),
        }
        players.set(playerKey, player)
      }
      player.goles += allocation.cantidad
      const stableTeamId = allocation.equipoId ?? allocation.equipoIdSnapshot
      const teamKey = stableTeamId ?? `snapshot:${allocation.equipoNombre ?? ''}`
      const team = player.equipos.get(teamKey) ?? {
        equipoId: stableTeamId,
        nombre: allocation.equipo?.nombre ?? allocation.equipoNombre ?? 'Equipo eliminado',
        goles: 0,
      }
      team.goles += allocation.cantidad
      player.equipos.set(teamKey, team)
    }

    const rows = [...players.values()]
      .sort((a, b) => b.goles - a.goles || a.nombre.localeCompare(b.nombre, 'es') || (a.jugadorId ?? '').localeCompare(b.jugadorId ?? ''))
      .map((player, index) => ({
        rank: index + 1,
        jugadorId: player.jugadorId,
        nombre: player.nombre,
        foto: player.foto,
        goles: player.goles,
        equipos: [...player.equipos.values()].sort((a, b) => b.goles - a.goles || a.nombre.localeCompare(b.nombre, 'es') || (a.equipoId ?? '').localeCompare(b.equipoId ?? '')),
      }))

    return { divisionId, ranking: 'SEQUENTIAL' as const, rows, unattributedGoals }
  },
}

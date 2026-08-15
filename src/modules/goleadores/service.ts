import { Prisma } from '../../generated/prisma/client'
import { prisma } from '../../config/database'
import type { AuthenticatedUser } from '../../types/auth'
import { NotFoundError } from '../../utils/errors'
import { visibleDivisionWhere } from '../../utils/divisionVisibility'

interface ScorerAggregateRow {
  jugadorId: string | null
  playerKey: string | null
  nombre: string | null
  foto: string | null
  equipoId: string | null
  teamKey: string | null
  equipoNombre: string | null
  golesEquipo: bigint | number | null
  golesJugador: bigint | number | null
  unattributedGoals: bigint | number
}

export const goleadoresService = {
  async findByDivision(divisionId: string, actor?: AuthenticatedUser) {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: { id: true },
    })
    if (!division) throw new NotFoundError('División')

    const aggregates = await prisma.$queryRaw<ScorerAggregateRow[]>(Prisma.sql`
      WITH eligible AS (
        SELECT
          a."jugadorId",
          a."jugadorIdSnapshot",
          a."equipoId",
          a."equipoIdSnapshot",
          a."jugadorNombre",
          a."equipoNombre",
          a.cantidad,
          j.nombre AS "currentPlayerName",
          j.foto AS "currentPlayerPhoto",
          e.nombre AS "currentTeamName"
        FROM "anotaciones_partido" a
        INNER JOIN "partidos" p ON p.id = a."partidoId"
        LEFT JOIN "jornadas" jo ON jo.id = p."jornadaId"
        LEFT JOIN "rondas_playoff" rp ON rp.id = p."rondaPlayoffId"
        LEFT JOIN "jugadores" j ON j.id = a."jugadorId"
        LEFT JOIN "equipos" e ON e.id = a."equipoId"
        WHERE p.estado = 'FINALIZADO'
          AND (jo."divisionId" = ${divisionId} OR rp."divisionId" = ${divisionId})
          AND p."tipoPartido" <> 'AMISTOSO'
          AND (p."tipoPartido" <> 'COMPLEMENTO' OR a."ladoMarcador" = 'LOCAL')
      ), attributed AS (
        SELECT
          COALESCE("jugadorId", "jugadorIdSnapshot") AS "jugadorId",
          COALESCE("jugadorId", "jugadorIdSnapshot", 'snapshot:' || "jugadorNombre") AS "playerKey",
          COALESCE("currentPlayerName", "jugadorNombre", 'Jugador eliminado') AS nombre,
          "currentPlayerPhoto" AS foto,
          COALESCE("equipoId", "equipoIdSnapshot") AS "equipoId",
          COALESCE("equipoId", "equipoIdSnapshot", 'snapshot:' || COALESCE("equipoNombre", '')) AS "teamKey",
          COALESCE("currentTeamName", "equipoNombre", 'Equipo eliminado') AS "equipoNombre",
          cantidad
        FROM eligible
        WHERE "jugadorId" IS NOT NULL OR "jugadorNombre" IS NOT NULL
      ), team_totals AS (
        SELECT
          "jugadorId", "playerKey", nombre, foto, "equipoId", "teamKey", "equipoNombre",
          SUM(cantidad) AS "golesEquipo"
        FROM attributed
        GROUP BY "jugadorId", "playerKey", nombre, foto, "equipoId", "teamKey", "equipoNombre"
      ), totals AS (
        SELECT COALESCE(SUM(cantidad) FILTER (
          WHERE "jugadorId" IS NULL AND "jugadorNombre" IS NULL
        ), 0) AS "unattributedGoals"
        FROM eligible
      )
      SELECT
        t."jugadorId", t."playerKey", t.nombre, t.foto, t."equipoId", t."teamKey", t."equipoNombre",
        t."golesEquipo", SUM(t."golesEquipo") OVER (PARTITION BY t."playerKey") AS "golesJugador",
        totals."unattributedGoals"
      FROM team_totals t
      CROSS JOIN totals
      UNION ALL
      SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, totals."unattributedGoals"
      FROM totals
      WHERE NOT EXISTS (SELECT 1 FROM team_totals)
    `)

    const unattributedGoals = Number(aggregates[0]?.unattributedGoals ?? 0)
    const players = new Map<string, {
      jugadorId: string | null
      nombre: string
      foto: string | null
      goles: number
      equipos: Map<string, { equipoId: string | null; nombre: string; goles: number }>
    }>()

    for (const aggregate of aggregates) {
      if (!aggregate.playerKey) continue
      let player = players.get(aggregate.playerKey)
      if (!player) {
        player = {
          jugadorId: aggregate.jugadorId,
          nombre: aggregate.nombre!,
          foto: aggregate.foto,
          goles: Number(aggregate.golesJugador),
          equipos: new Map(),
        }
        players.set(aggregate.playerKey, player)
      }
      const team = player.equipos.get(aggregate.teamKey!) ?? {
        equipoId: aggregate.equipoId,
        nombre: aggregate.equipoNombre!,
        goles: 0,
      }
      team.goles += Number(aggregate.golesEquipo)
      player.equipos.set(aggregate.teamKey!, team)
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

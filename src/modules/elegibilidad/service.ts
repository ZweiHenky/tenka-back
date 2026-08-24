import { prisma } from '../../config/database'
import type { Prisma } from '../../generated/prisma/client'
import type { AuthenticatedUser } from '../../types/auth'
import { NotFoundError } from '../../utils/errors'
import { visibleDivisionWhere } from '../../utils/divisionVisibility'

export interface FilaElegibilidad {
  jugadorId: string
  nombre: string
  equipoId: string | null
  equipoNombre: string | null
  partidosJugados: number
  elegible: boolean
}

/**
 * Los partidos que cuentan para el mínimo de eliminatorias.
 *
 * Del **complemento solo cuenta el equipo que suma puntos** (el local), igual que en
 * `tablaPosicion.recalcular`: el visitante "repite sin puntos" y ahí tampoco recibe nada. Los
 * amistosos no cuentan, y los del propio cuadro tampoco — el requisito es sobre la fase regular.
 */
export function participacionesQueCuentan(divisionId: string): Prisma.ParticipacionPartidoWhereInput {
  return {
    partido: {
      estado: 'FINALIZADO',
      rondaPlayoffId: null,
      jornada: { divisionId },
    },
    OR: [
      { partido: { tipoPartido: 'REGULAR' } },
      { partido: { tipoPartido: 'COMPLEMENTO' }, ladoMarcador: 'LOCAL' },
    ],
  }
}

/**
 * Cuántos partidos que cuentan lleva cada jugador de la lista.
 *
 * Se agrupa por `jugadorIdSnapshot` y no por `jugadorId`: el snapshot sobrevive a la baja del
 * jugador, y es el mismo criterio con el que se guardan las participaciones.
 */
export async function contarPartidosJugados(
  tx: Pick<Prisma.TransactionClient, 'participacionPartido'>,
  divisionId: string,
  jugadorIds: string[],
): Promise<Map<string, number>> {
  if (jugadorIds.length === 0) return new Map()
  const filas = await tx.participacionPartido.groupBy({
    by: ['jugadorIdSnapshot'],
    where: { ...participacionesQueCuentan(divisionId), jugadorIdSnapshot: { in: jugadorIds } },
    _count: { _all: true },
  })
  return new Map(filas.map((fila) => [fila.jugadorIdSnapshot, fila._count._all]))
}

export const elegibilidadService = {
  /** Plantel de la división con sus partidos jugados y si alcanzan el mínimo. */
  async findByDivision(divisionId: string, actor?: AuthenticatedUser): Promise<{ minimo: number; rows: FilaElegibilidad[] }> {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, ...visibleDivisionWhere(actor) },
      select: { id: true, minPartidosEliminatoria: true, registrarParticipaciones: true },
    })
    if (!division) throw new NotFoundError('División')

    const plantel = await prisma.divisionJugador.findMany({
      where: { divisionId },
      select: {
        jugadorId: true,
        equipoId: true,
        jugador: { select: { nombre: true } },
        equipo: { select: { nombre: true } },
      },
    })

    const conteos = await contarPartidosJugados(prisma, divisionId, plantel.map((fila) => fila.jugadorId))
    // Sin registro de participantes no hay dato de quién jugó, así que exigir un mínimo dejaría
    // fuera a todos. El requisito solo existe cuando ese registro está encendido.
    const minimo = division.registrarParticipaciones ? division.minPartidosEliminatoria : 0

    const rows = plantel.map((fila) => {
      const partidosJugados = conteos.get(fila.jugadorId) ?? 0
      return {
        jugadorId: fila.jugadorId,
        nombre: fila.jugador.nombre,
        equipoId: fila.equipoId,
        equipoNombre: fila.equipo?.nombre ?? null,
        partidosJugados,
        elegible: partidosJugados >= minimo,
      }
    })
    rows.sort((a, b) => b.partidosJugados - a.partidosJugados || a.nombre.localeCompare(b.nombre))

    return { minimo, rows }
  },
}

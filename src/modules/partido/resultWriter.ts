import type { Prisma } from '../../generated/prisma/client'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors'
import { assertDivisionWritable } from '../../utils/divisionState'
import { tablaPosicionService } from '../tabla-posicion/service'
import { rondaPlayoffService } from '../ronda-playoff/service'
import { validatePlayoffFinalizationSchedule } from './playoffFinalization'
import type { ResultInput } from './validator'
import { exposePartidoReadWithNotas } from './repository'

const RESULT_CONTEXT_SELECT = {
  id: true,
  version: true,
  estado: true,
  golesLocal: true,
  golesVisitante: true,
  penalesLocal: true,
  penalesVisitante: true,
  tipoPartido: true,
  jornadaId: true,
  rondaPlayoffId: true,
  equipoLocalId: true,
  equipoVisitanteId: true,
  fecha: true,
  fechaFin: true,
  canchaId: true,
  jornada: { select: { division: { select: { id: true, registrarParticipaciones: true, registrarGoleo: true, usarPenalesEnEmpates: true, estadoLiga: { select: { codigo: true } }, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
  rondaPlayoff: { select: { division: { select: { id: true, registrarParticipaciones: true, registrarGoleo: true, usarPenalesEnEmpates: true, estadoLiga: { select: { codigo: true } }, liga: { select: { id: true, userId: true, multiplesCanchas: true } } } } } },
} as const

export async function getResultContext(tx: Pick<Prisma.TransactionClient, 'partido'>, partidoId: string) {
  const partido = await tx.partido.findUnique({ where: { id: partidoId }, select: RESULT_CONTEXT_SELECT })
  if (!partido) throw new NotFoundError('Partido')
  const division = partido.jornada?.division ?? partido.rondaPlayoff?.division
  if (!division) throw new ValidationError('El partido no pertenece a una división')
  return { partido, division }
}

export async function writeResultInTransaction(
  tx: Prisma.TransactionClient,
  partidoId: string,
  input: ResultInput,
) {
  const { partido, division } = await getResultContext(tx, partidoId)
  if (partido.version !== input.expectedVersion) {
    throw new ConflictError('El resultado cambió; actualiza los datos y vuelve a intentarlo')
  }

  if (input.estado === 'FINALIZADO') {
    const tied = input.golesLocal === input.golesVisitante
    const hasLocalPenalties = input.penalesLocal != null
    const hasVisitorPenalties = input.penalesVisitante != null
    const hasAnyPenalties = hasLocalPenalties || hasVisitorPenalties
    const hasCompletePenalties = hasLocalPenalties && hasVisitorPenalties
    const requiresPenalties = tied && (partido.rondaPlayoffId != null
      || (partido.tipoPartido !== 'AMISTOSO' && division.usarPenalesEnEmpates))

    if (!tied && hasAnyPenalties) {
      throw new ValidationError('Los penales solo pueden registrarse cuando el marcador está empatado')
    }
    if (requiresPenalties && (!hasCompletePenalties || input.penalesLocal === input.penalesVisitante)) {
      throw new ValidationError(partido.rondaPlayoffId
        ? 'El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.'
        : 'El empate debe definir un ganador por penales.')
    }
    if (!requiresPenalties && hasAnyPenalties) {
      throw new ValidationError('Esta división no usa penales para resolver empates')
    }
  }

  if (input.estado === 'FINALIZADO' && partido.rondaPlayoffId) {
    const scheduleError = validatePlayoffFinalizationSchedule({
      fecha: partido.fecha,
      fechaFin: partido.fechaFin,
      multiplesCanchas: division.liga.multiplesCanchas,
      canchaId: partido.canchaId,
    })
    if (scheduleError) throw new ValidationError(scheduleError)
  }
  if (partido.estado === 'FINALIZADO' && partido.rondaPlayoffId && input.estado === 'PROGRAMADO') {
    throw new ValidationError('Un partido de eliminatoria finalizado solo puede corregirse o suspenderse')
  }

  if (input.estado !== 'FINALIZADO' && (input.notas !== undefined || input.participaciones !== undefined)) {
    throw new ValidationError('Las notas y los participantes solo pueden guardarse al finalizar el partido')
  }

  // Una división finalizada o cancelada no acepta resultados nuevos, ni desde la app ni desde
  // el enlace del árbitro: los dos caminos pasan por aquí.
  assertDivisionWritable(division.estadoLiga);

  // Con el goleo apagado el servidor ignora lo que mande el cliente: ni valida ni escribe
  // atribuciones nuevas. Las ya guardadas se congelan más abajo, no se borran.
  const goleoActivo = division.registrarGoleo
  const allocations = goleoActivo ? input.allocations : []

  const namedKeys = new Set<string>()
  const totals = { LOCAL: 0, VISITANTE: 0 }
  const namedPlayerIds: string[] = []
  for (const allocation of allocations) {
    totals[allocation.ladoMarcador] += allocation.cantidad
    if (!allocation.jugadorId) continue
    const key = `${allocation.ladoMarcador}:${allocation.jugadorId}`
    if (namedKeys.has(key)) throw new ValidationError('No se puede repetir un jugador en el mismo lado del marcador')
    namedKeys.add(key)
    namedPlayerIds.push(allocation.jugadorId)
  }
  if (totals.LOCAL > input.golesLocal || totals.VISITANTE > input.golesVisitante) {
    throw new ValidationError('Las anotaciones asignadas no pueden superar el marcador')
  }

  const shouldWriteParticipations = division.registrarParticipaciones && input.estado === 'FINALIZADO'
  if (shouldWriteParticipations && input.participaciones === undefined) {
    throw new ValidationError('Debes registrar los jugadores que participaron en el partido')
  }

  const participacionList = shouldWriteParticipations ? (input.participaciones ?? []) : []
  const participationKeys = new Set<string>()
  const participationUniquePlayers = new Set<string>()
  const participationPlayerIds: string[] = []
  if (shouldWriteParticipations) {
    for (const participacion of participacionList) {
      const key = `${participacion.ladoMarcador}:${participacion.jugadorId}`
      if (participationKeys.has(key)) {
        throw new ValidationError('No se puede repetir un jugador en el mismo lado de la participación')
      }
      participationKeys.add(key)
      if (participationUniquePlayers.has(participacion.jugadorId)) {
        throw new ValidationError('Un jugador no puede participar por ambos equipos')
      }
      participationUniquePlayers.add(participacion.jugadorId)
      participationPlayerIds.push(participacion.jugadorId)
    }
    for (const allocation of allocations) {
      if (!allocation.jugadorId) continue
      if (!participationKeys.has(`${allocation.ladoMarcador}:${allocation.jugadorId}`)) {
        throw new ValidationError('Todos los goleadores deben estar registrados como participantes del partido')
      }
    }
  }

  const historicalParticipations = !shouldWriteParticipations && input.estado === 'FINALIZADO'
    ? await tx.participacionPartido.findMany({
        where: { partidoId },
        select: { jugadorId: true, jugadorIdSnapshot: true, ladoMarcador: true },
      })
    : []
  if (historicalParticipations.length > 0) {
    const historyKeys = new Set(historicalParticipations.map((row) => `${row.ladoMarcador}:${row.jugadorId ?? row.jugadorIdSnapshot}`))
    for (const allocation of allocations) {
      if (!allocation.jugadorId) continue
      if (!historyKeys.has(`${allocation.ladoMarcador}:${allocation.jugadorId}`)) {
        throw new ValidationError('El goleador no está en el historial de participantes del partido. Activa el registro de participantes para corregir la lista')
      }
    }
  }

  const memberships = namedPlayerIds.length === 0 && participationPlayerIds.length === 0 ? [] : await tx.divisionJugador.findMany({
    where: { divisionId: division.id, jugadorId: { in: [...new Set([...namedPlayerIds, ...participationPlayerIds])] } },
    select: {
      jugadorId: true,
      equipoId: true,
      dorsal: true,
      jugador: { select: { nombre: true } },
      equipo: { select: { nombre: true } },
    },
  })
  const teamIds = { LOCAL: partido.equipoLocalId, VISITANTE: partido.equipoVisitanteId }
  const membershipByTeamPlayer = new Map(memberships.map((membership) => [`${membership.equipoId}:${membership.jugadorId}`, membership]))
  const namedPlayerIdsSet = new Set(namedPlayerIds)
  const participationPlayerIdsSet = new Set(participationPlayerIds)
  const previousAllocations = namedPlayerIdsSet.size === 0 ? [] : await tx.anotacionPartido.findMany({
    where: {
      partidoId,
      OR: [
        { jugadorId: { in: [...namedPlayerIdsSet] } },
        { jugadorIdSnapshot: { in: [...namedPlayerIdsSet] } },
      ],
    },
    select: { jugadorId: true, jugadorIdSnapshot: true, equipoId: true, equipoIdSnapshot: true, ladoMarcador: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
  })
  const previousParticipations = participationPlayerIdsSet.size === 0 ? [] : await tx.participacionPartido.findMany({
    where: {
      partidoId,
      OR: [
        { jugadorId: { in: [...participationPlayerIdsSet] } },
        { jugadorIdSnapshot: { in: [...participationPlayerIdsSet] } },
      ],
    },
    select: { jugadorId: true, jugadorIdSnapshot: true, equipoId: true, equipoIdSnapshot: true, ladoMarcador: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
  })
  const namedRows = allocations.filter((allocation) => allocation.jugadorId).map((allocation) => {
    const equipoId = teamIds[allocation.ladoMarcador]
    const membership = membershipByTeamPlayer.get(`${equipoId}:${allocation.jugadorId}`)
    const previous = previousAllocations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === allocation.jugadorId
      && row.ladoMarcador === allocation.ladoMarcador)
    if (!membership && !previous) {
      throw new ValidationError('El jugador no pertenece al equipo y división correspondientes al partido')
    }
    return {
      partidoId,
      jugadorId: membership ? allocation.jugadorId : (previous?.jugadorId ?? null),
      equipoId: membership ? equipoId : (previous?.equipoId ?? null),
      jugadorIdSnapshot: previous?.jugadorIdSnapshot ?? allocation.jugadorId,
      equipoIdSnapshot: previous?.equipoIdSnapshot ?? equipoId,
      ladoMarcador: allocation.ladoMarcador,
      cantidad: allocation.cantidad,
      jugadorNombre: previous?.jugadorNombre ?? membership?.jugador.nombre ?? 'Jugador',
      equipoNombre: previous?.equipoNombre ?? membership?.equipo.nombre ?? 'Equipo',
      dorsal: previous ? previous.dorsal : (membership?.dorsal ?? null),
    }
  })

  const participationRows = participacionList.map((participacion) => {
    const equipoId = teamIds[participacion.ladoMarcador]
    const membership = membershipByTeamPlayer.get(`${equipoId}:${participacion.jugadorId}`)
    const previous = previousParticipations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === participacion.jugadorId
      && row.ladoMarcador === participacion.ladoMarcador)
      ?? previousAllocations.find((row) => (row.jugadorId ?? row.jugadorIdSnapshot) === participacion.jugadorId
        && row.ladoMarcador === participacion.ladoMarcador)
    if (!membership && !previous) {
      throw new ValidationError('El jugador no pertenece al equipo y división correspondientes al partido')
    }
    return {
      partidoId,
      jugadorId: membership ? participacion.jugadorId : (previous?.jugadorId ?? null),
      equipoId: membership ? equipoId : (previous?.equipoId ?? null),
      jugadorIdSnapshot: previous?.jugadorIdSnapshot ?? participacion.jugadorId,
      equipoIdSnapshot: previous?.equipoIdSnapshot ?? equipoId!,
      ladoMarcador: participacion.ladoMarcador,
      jugadorNombre: previous?.jugadorNombre ?? membership?.jugador.nombre ?? 'Jugador',
      equipoNombre: previous?.equipoNombre ?? membership?.equipo.nombre ?? 'Equipo',
      dorsal: previous ? previous.dorsal : (membership?.dorsal ?? null),
    }
  })

  const updatedCount = await tx.partido.updateMany({
    where: { id: partidoId, version: input.expectedVersion },
    data: input.estado === 'PROGRAMADO'
      ? { estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } }
      : input.estado === 'SUSPENDIDO'
        ? {
            estado: 'SUSPENDIDO',
            golesLocal: partido.golesLocal,
            golesVisitante: partido.golesVisitante,
            penalesLocal: partido.penalesLocal,
            penalesVisitante: partido.penalesVisitante,
            version: { increment: 1 },
          }
        : {
          estado: input.estado,
          golesLocal: input.golesLocal,
          golesVisitante: input.golesVisitante,
          penalesLocal: input.penalesLocal ?? null,
          penalesVisitante: input.penalesVisitante ?? null,
          ...(input.notas !== undefined ? { notas: input.notas } : {}),
          version: { increment: 1 },
          },
  })
  if (updatedCount.count !== 1) throw new ConflictError('El resultado cambió; actualiza los datos y vuelve a intentarlo')

  if (input.estado === 'PROGRAMADO') {
    await tx.anotacionPartido.deleteMany({ where: { partidoId } })
    await tx.participacionPartido.deleteMany({ where: { partidoId } })
  } else if (input.estado === 'FINALIZADO') {
    const teamRows = await tx.equipo.findMany({
      where: { id: { in: [partido.equipoLocalId, partido.equipoVisitanteId].filter((id): id is string => Boolean(id)) } },
      select: { id: true, nombre: true },
    })
    const teamNames = new Map(teamRows.map((team) => [team.id, team.nombre]))
    const buildUnattributedRows = (namedTotalFor: (side: 'LOCAL' | 'VISITANTE') => number) =>
      (['LOCAL', 'VISITANTE'] as const).flatMap((side) => {
        const score = side === 'LOCAL' ? input.golesLocal : input.golesVisitante
        const cantidad = score - namedTotalFor(side)
        const equipoId = teamIds[side]
        return cantidad > 0 ? [{
          partidoId,
          jugadorId: null,
          equipoId,
          jugadorIdSnapshot: null,
          equipoIdSnapshot: equipoId,
          ladoMarcador: side,
          cantidad,
          jugadorNombre: null,
          equipoNombre: equipoId ? teamNames.get(equipoId) ?? null : null,
          dorsal: null,
        }] : []
      })

    if (goleoActivo) {
      const unattributedRows = buildUnattributedRows((side) =>
        namedRows.filter((row) => row.ladoMarcador === side).reduce((sum, row) => sum + row.cantidad, 0))
      await tx.anotacionPartido.deleteMany({ where: { partidoId } })
      if (namedRows.length + unattributedRows.length > 0) {
        await tx.anotacionPartido.createMany({ data: [...namedRows, ...unattributedRows] })
      }
    } else {
      // Congelado. Las filas con jugador se quedan como están —borrarlas perdería el historial,
      // y el editor está deshabilitado, así que nadie podría recapturarlo—. Solo se rehacen los
      // goles sin dueño, para que la suma siga cuadrando si cambió el marcador.
      const atribuidas = await tx.anotacionPartido.findMany({
        where: { partidoId, jugadorIdSnapshot: { not: null } },
        select: { ladoMarcador: true, cantidad: true },
      })
      await tx.anotacionPartido.deleteMany({ where: { partidoId, jugadorIdSnapshot: null } })
      const unattributedRows = buildUnattributedRows((side) =>
        atribuidas.filter((row) => row.ladoMarcador === side).reduce((sum, row) => sum + row.cantidad, 0))
      if (unattributedRows.length > 0) {
        await tx.anotacionPartido.createMany({ data: unattributedRows })
      }
    }
    if (shouldWriteParticipations) {
      await tx.participacionPartido.deleteMany({ where: { partidoId } })
      if (participationRows.length > 0) {
        await tx.participacionPartido.createMany({ data: participationRows })
      }
    }
  }

  if (partido.jornadaId && (partido.estado === 'FINALIZADO' || input.estado === 'FINALIZADO' || input.estado === 'PROGRAMADO' || input.estado === 'SUSPENDIDO')) {
    await tablaPosicionService.recalcular(division.id, tx)
  }
  if (partido.rondaPlayoffId) await rondaPlayoffService.syncAdvancement(tx, partido.rondaPlayoffId)

  const updated = await tx.partido.findUnique({
    where: { id: partidoId },
    include: {
      anotaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
      participaciones: { orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }] },
    },
  })
  return updated ? exposePartidoReadWithNotas(updated) : updated
}

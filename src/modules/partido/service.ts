import { prisma } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { exposePartidoRead, PARTIDO_READ_INCLUDE, partidoRepository } from './repository';
import { tablaPosicionService } from '../tabla-posicion/service';
import { rondaPlayoffService } from '../ronda-playoff/service';
import type { PartidoEntity } from './entity';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import { validatePlayoffFinalizationSchedule } from './playoffFinalization';
import { writeResultInTransaction } from './resultWriter';
import type { ResultInput } from './validator';
import type { Pagination } from '../../utils/pagination';
import { collectScheduleChanges, enqueueScheduleChange } from '../notification/scheduleChangeOutbox';

const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

class StaleReplacementPlanError extends Error {}

const REPLACEMENT_INCOMPATIBLE_FIELDS = new Set([
  'golesLocal', 'golesVisitante', 'penalesLocal', 'penalesVisitante', 'estado',
  'jornadaId', 'rondaPlayoffId', 'tipoPartido',
])

async function assertParentOwner(jornadaId: string | undefined, rondaPlayoffId: string | undefined, actor: AuthenticatedUser): Promise<void> {
  const parent = jornadaId
    ? await prisma.jornada.findUnique({ where: { id: jornadaId }, select: { division: { select: { liga: { select: { userId: true } } } } } })
    : rondaPlayoffId
      ? await prisma.rondaPlayoff.findUnique({ where: { id: rondaPlayoffId }, select: { division: { select: { liga: { select: { userId: true } } } } } })
      : null;
  if (!parent) throw new NotFoundError(jornadaId ? 'Jornada' : rondaPlayoffId ? 'Ronda playoff' : 'Partido');
  assertOwnerOrAdmin(actor, parent.division.liga.userId, 'Partido');
}

export function findDeterministicMatching(teamIds: string[], occurrences: ReadonlyMap<string, number>): Array<[string, string]> | null {
  const sorted = [...teamIds].sort((a, b) => a.localeCompare(b))
  if (sorted.length % 2 !== 0 || new Set(sorted).size !== sorted.length) return null
  if (sorted.length === 0) return []

  type Candidate = { pairs: Array<[string, string]>; total: number; frequencies: number[]; signature: string }
  const normalize = (pairs: Array<[string, string]>): Array<[string, string]> => pairs
    .map(([a, b]) => a < b ? [a, b] : [b, a])
    .sort((a, b) => pairKey(a[0], a[1]).localeCompare(pairKey(b[0], b[1]))) as Array<[string, string]>
  const score = (pairs: Array<[string, string]>): Candidate => {
    const normalized = normalize(pairs)
    const frequencies = normalized.map(([a, b]) => occurrences.get(pairKey(a, b)) ?? 0)
    return {
      pairs: normalized,
      total: frequencies.reduce((sum, frequency) => sum + frequency, 0),
      // After aggregate frequency, minimize the most-repeated selected pair first.
      frequencies: frequencies.sort((a, b) => b - a),
      signature: normalized.map(([a, b]) => pairKey(a, b)).join(','),
    }
  }
  const compare = (a: Candidate, b: Candidate): number => {
    if (a.total !== b.total) return a.total - b.total
    for (let i = 0; i < a.frequencies.length; i++) {
      if (a.frequencies[i] !== b.frequencies[i]) return a.frequencies[i] - b.frequencies[i]
    }
    return a.signature.localeCompare(b.signature)
  }

  // Circle rounds provide n - 1 deterministic perfect matchings and cover every possible pair once.
  let rotation = [...sorted]
  let best: Candidate | null = null
  for (let round = 0; round < sorted.length - 1; round++) {
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < rotation.length / 2; i++) {
      pairs.push([rotation[i], rotation[rotation.length - 1 - i]])
    }
    const candidate = score(pairs)
    if (!best || compare(candidate, best) < 0) best = candidate
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)]
  }

  // Deterministic best-improvement 2-opt broadens the circle candidates with a polynomial bound.
  for (let step = 0; step < sorted.length * sorted.length; step++) {
    let improved = best
    for (let i = 0; i < best!.pairs.length; i++) {
      for (let j = i + 1; j < best!.pairs.length; j++) {
        const [a, b] = best!.pairs[i]
        const [c, d] = best!.pairs[j]
        for (const replacements of [[[a, c], [b, d]], [[a, d], [b, c]]] as Array<Array<[string, string]>>) {
          const pairs = best!.pairs.filter((_, index) => index !== i && index !== j).concat(replacements)
          const candidate = score(pairs)
          if (compare(candidate, improved!) < 0) improved = candidate
        }
      }
    }
    if (improved === best) break
    best = improved
  }

  return best!.pairs
}

export const partidoService = {
  async list(actor?: AuthenticatedUser): Promise<PartidoEntity[]> {
    return partidoRepository.findAllVisible(actor);
  },

  async listPaginated(pagination: Pagination, actor?: AuthenticatedUser) {
    return partidoRepository.findAllVisiblePaginated(pagination, actor);
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<PartidoEntity> {
    const t = await partidoRepository.findVisibleById(id, actor);
    if (!t) throw new NotFoundError('Partido');
    return t;
  },

  async findByJornada(jornadaId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[]> {
    const partidos = await partidoRepository.findVisibleByJornada(jornadaId, actor);
    if (!partidos) throw new NotFoundError('Jornada');
    return partidos;
  },

  async findByRondaPlayoff(rondaPlayoffId: string, actor?: AuthenticatedUser): Promise<PartidoEntity[]> {
    const partidos = await partidoRepository.findVisibleByRondaPlayoff(rondaPlayoffId, actor);
    if (!partidos) throw new NotFoundError('Ronda playoff');
    return partidos;
  },

  async create(data: {
    golesLocal?: number;
    golesVisitante?: number;
    penalesLocal?: number;
    penalesVisitante?: number;
    fecha?: string;
    estado?: string;
    llave?: number;
    jornadaId?: string;
    rondaPlayoffId?: string;
    equipoLocalId: string | null;
    equipoVisitanteId: string | null;
    tipoPartido?: string;
  }, actor: AuthenticatedUser): Promise<PartidoEntity> {
    await assertParentOwner(data.jornadaId, data.rondaPlayoffId, actor);
    const partido = await partidoRepository.create(data);
    if (data.estado === 'FINALIZADO' && data.jornadaId) {
      await this._recalcularDivision(data.jornadaId);
    }
    return partido;
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<PartidoEntity> {
    const ctx = await partidoRepository.findAuthorizationContext(id)
    if (!ctx) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, ctx.ligaUserId, 'Partido')

    const replacesLocal = data.equipoLocalId !== undefined
    const replacesVisitor = data.equipoVisitanteId !== undefined
    if (replacesLocal || replacesVisitor) {
      if (replacesLocal && replacesVisitor) {
        throw new ValidationError('Solo se puede intercambiar un equipo por solicitud')
      }
      if (Object.keys(data).some((field) => REPLACEMENT_INCOMPATIBLE_FIELDS.has(field))) {
        throw new ValidationError('No se puede combinar el reemplazo de equipo con cambios de resultado, estado, tipo o jornada')
      }

      const incomingId = (replacesLocal ? data.equipoLocalId : data.equipoVisitanteId) as string
      if (!incomingId) throw new ValidationError('Los equipos del intercambio son obligatorios')

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            await acquireLeagueScheduleLock(tx, ctx.ligaId)

            const lockedCtx = await partidoRepository.findAuthorizationContext(id, tx)
            if (!lockedCtx) throw new NotFoundError('Partido')
            assertOwnerOrAdmin(actor, lockedCtx.ligaUserId, 'Partido')
            if (lockedCtx.ligaId !== ctx.ligaId) throw new StaleReplacementPlanError()
            if (lockedCtx.estado !== 'PROGRAMADO') {
              throw new ValidationError('Solo se pueden reemplazar equipos en partidos programados')
            }
            if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || !lockedCtx.divisionId || lockedCtx.tipoPartido !== 'REGULAR') {
              throw new ValidationError('Solo se pueden reemplazar equipos en partidos regulares de jornada')
            }

            const linkedTeams = await tx.divisionEquipo.count({
              where: { divisionId: lockedCtx.divisionId, equipoId: incomingId },
            })
            if (linkedTeams !== 1) {
              throw new ValidationError('El equipo de reemplazo no pertenece a la división de la jornada')
            }

            const jornadas = await tx.jornada.findMany({
              where: { divisionId: lockedCtx.divisionId },
              orderBy: { numero: 'asc' },
              select: {
                id: true,
                numero: true,
                partidos: {
                  where: { rondaPlayoffId: null, tipoPartido: 'REGULAR' },
                  select: { id: true, estado: true, fecha: true, fechaFin: true, equipoLocalId: true, equipoVisitanteId: true },
                },
              },
            })
            const currentJornada = jornadas.find((jornada) => jornada.id === lockedCtx.jornadaId)
            if (!currentJornada) throw new ValidationError('La jornada del partido ya no está disponible')

            const current = currentJornada.partidos.find((partido) => partido.id === id)
            if (!current) throw new StaleReplacementPlanError()
            if (current.estado !== 'PROGRAMADO') {
              throw new ValidationError('Solo se pueden reemplazar equipos en partidos programados')
            }
            const outgoingId = replacesLocal ? current.equipoLocalId : current.equipoVisitanteId
            if (!outgoingId) throw new ValidationError('Los equipos del intercambio son obligatorios')
            const currentLocalId = replacesLocal ? incomingId : current.equipoLocalId
            const currentVisitorId = replacesVisitor ? incomingId : current.equipoVisitanteId
            if (currentLocalId === currentVisitorId) {
              throw new ValidationError('El equipo local y visitante deben ser diferentes')
            }

            const targets = currentJornada.partidos.filter((partido) => (
              partido.id !== id
              && (partido.equipoLocalId === incomingId || partido.equipoVisitanteId === incomingId)
            ))
            if (targets.length === 0) {
              throw new ValidationError('El equipo seleccionado no tiene otro partido en esta jornada para intercambiar')
            }
            if (targets.length > 1) {
              throw new ValidationError('El equipo seleccionado aparece en varios partidos de esta jornada; el intercambio es ambiguo')
            }
            const target = targets[0]
            if (target.estado !== 'PROGRAMADO') {
              throw new ValidationError('El partido del equipo seleccionado debe estar programado')
            }
            const targetLocalId = target.equipoLocalId === incomingId ? outgoingId : target.equipoLocalId
            const targetVisitorId = target.equipoVisitanteId === incomingId ? outgoingId : target.equipoVisitanteId
            if (targetLocalId === targetVisitorId) {
              throw new ValidationError('El intercambio produciría un partido con el mismo equipo como local y visitante')
            }

            const replacementStart = data.fecha !== undefined ? new Date(data.fecha as string) : current.fecha
            const replacementEnd = data.fechaFin !== undefined ? new Date(data.fechaFin as string) : current.fechaFin
            const intervals = [
              { teamId: incomingId, start: replacementStart, end: replacementEnd },
              { teamId: outgoingId, start: target.fecha, end: target.fechaFin },
            ].filter((interval): interval is { teamId: string; start: Date; end: Date } => Boolean(interval.start && interval.end))
            if (intervals.length > 0) {
              const conflict = await tx.partido.findFirst({
                where: {
                  id: { notIn: [id, target.id] },
                  AND: [
                    { OR: [
                      { jornada: { divisionId: lockedCtx.divisionId } },
                      { rondaPlayoff: { divisionId: lockedCtx.divisionId } },
                    ] },
                    { OR: intervals.map((interval) => ({
                      fecha: { lt: interval.end },
                      fechaFin: { gt: interval.start },
                      OR: [{ equipoLocalId: interval.teamId }, { equipoVisitanteId: interval.teamId }],
                    })) },
                  ],
                },
                select: { id: true },
              })
              if (conflict) throw new ValidationError('Uno de los equipos ya tiene un partido en el horario resultante')
            }

            const future = jornadas.filter((jornada) => jornada.numero > currentJornada.numero)
            if (future.some((jornada) => jornada.partidos.some((partido) => partido.estado !== 'PROGRAMADO'))) {
              throw new ValidationError('No se puede recalcular: todos los partidos regulares de jornadas posteriores deben estar programados')
            }

            const occurrences = new Map<string, number>()
            for (const jornada of jornadas) {
              if (jornada.numero >= currentJornada.numero) continue
              for (const partido of jornada.partidos) {
                if (partido.equipoLocalId && partido.equipoVisitanteId) {
                  const key = pairKey(partido.equipoLocalId, partido.equipoVisitanteId)
                  occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
                }
              }
            }

            const currentPairs = new Set<string>()
            for (const partido of currentJornada.partidos) {
              const local = partido.id === id ? currentLocalId : partido.id === target.id ? targetLocalId : partido.equipoLocalId
              const visitor = partido.id === id ? currentVisitorId : partido.id === target.id ? targetVisitorId : partido.equipoVisitanteId
              if (!local || !visitor || local === visitor) throw new ValidationError('La jornada actual contiene partidos regulares incompletos o inválidos')
              const key = pairKey(local, visitor)
              if (currentPairs.has(key)) throw new ValidationError('El intercambio produciría un enfrentamiento duplicado dentro de la jornada actual')
              currentPairs.add(key)
              occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
            }

            const recalculated: Array<{ jornadaId: string; slots: typeof future[number]['partidos']; pairs: Array<[string, string]> }> = []
            for (const jornada of future) {
              const slots = [...jornada.partidos].sort((a, b) => {
                const dateOrder = (a.fecha?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.fecha?.getTime() ?? Number.MAX_SAFE_INTEGER)
                return dateOrder || a.id.localeCompare(b.id)
              })
              const teams = slots.flatMap((partido) => [partido.equipoLocalId, partido.equipoVisitanteId]).filter((team): team is string => Boolean(team))
              if (teams.length !== slots.length * 2 || new Set(teams).size !== teams.length) {
                throw new ValidationError(`La jornada ${jornada.numero} tiene participantes regulares incompletos o duplicados`)
              }
              const pairs = findDeterministicMatching(teams, occurrences)
              if (!pairs) throw new ValidationError(`No existe una combinación válida para la jornada ${jornada.numero}`)
              for (const [local, visitor] of pairs) {
                const key = pairKey(local, visitor)
                occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
              }
              recalculated.push({ jornadaId: jornada.id, slots, pairs })
            }

            const writes = [
              {
                id,
                jornadaId: currentJornada.id,
                expected: current,
                data: { ...data, equipoLocalId: currentLocalId, equipoVisitanteId: currentVisitorId, notas: null },
              },
              {
                id: target.id,
                jornadaId: currentJornada.id,
                expected: target,
                data: { equipoLocalId: targetLocalId, equipoVisitanteId: targetVisitorId, notas: null },
              },
              ...recalculated.flatMap((jornada) => jornada.slots.map((slot, index) => ({
                id: slot.id,
                jornadaId: jornada.jornadaId,
                expected: slot,
                data: { equipoLocalId: jornada.pairs[index][0], equipoVisitanteId: jornada.pairs[index][1], notas: null },
              }))),
            ].sort((a, b) => a.id.localeCompare(b.id))

            for (const write of writes) {
              const result = await tx.partido.updateMany({
                where: {
                  id: write.id,
                  estado: write.expected.estado,
                  jornadaId: write.jornadaId,
                  rondaPlayoffId: null,
                  tipoPartido: 'REGULAR',
                  equipoLocalId: write.expected.equipoLocalId,
                  equipoVisitanteId: write.expected.equipoVisitanteId,
                },
                data: write.data,
              })
              if (result.count !== 1) throw new StaleReplacementPlanError()
            }

            await enqueueScheduleChange(tx, {
              divisionId: lockedCtx.divisionId,
              ligaId: lockedCtx.ligaId,
              changes: collectScheduleChanges(writes),
            })

            const updated = await tx.partido.findUnique({ where: { id }, include: PARTIDO_READ_INCLUDE })
            if (!updated) throw new StaleReplacementPlanError()
            return { ...exposePartidoRead(updated), jornadasRecalculadas: recalculated.length }
          }, { isolationLevel: 'Serializable' })
        } catch (error: any) {
          const retryable = error instanceof StaleReplacementPlanError || error?.code === 'P2034'
          if (retryable && attempt < 2) continue
          if (retryable) throw new ConflictError('La programación cambió durante el intercambio; vuelve a intentarlo')
          throw error
        }
      }
      throw new ConflictError('La programación cambió durante el intercambio; vuelve a intentarlo')
    }

    if (data.jornadaId !== undefined || data.rondaPlayoffId !== undefined) {
      await assertParentOwner(data.jornadaId as string | undefined, data.rondaPlayoffId as string | undefined, actor)
    }
    if (ctx.estado === 'FINALIZADO' && (!ctx.jornadaId || ctx.rondaPlayoffId)) {
      const allowedTargets = ctx.rondaPlayoffId ? ['SUSPENDIDO'] : ['SUSPENDIDO', 'PROGRAMADO']
      if (!allowedTargets.includes(data.estado as string)) {
        throw new ValidationError('No se puede modificar un partido ya finalizado')
      }
    }

    if (ctx.rondaPlayoffId) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            await acquireLeagueScheduleLock(tx, ctx.ligaId)
            const lockedCtx = await partidoRepository.findAuthorizationContext(id, tx)
            if (!lockedCtx) throw new NotFoundError('Partido')
            assertOwnerOrAdmin(actor, lockedCtx.ligaUserId, 'Partido')
            if (!lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
              throw new ConflictError('El partido cambió durante la actualización; vuelve a intentarlo')
            }
            if (lockedCtx.estado === 'FINALIZADO' && data.estado !== 'SUSPENDIDO') {
              throw new ValidationError('No se puede modificar un partido ya finalizado')
            }
            if (data.estado === 'FINALIZADO') {
              const scheduleError = validatePlayoffFinalizationSchedule({
                fecha: lockedCtx.fecha,
                fechaFin: lockedCtx.fechaFin,
                multiplesCanchas: lockedCtx.multiplesCanchas,
                canchaId: lockedCtx.canchaId,
              })
              if (scheduleError) throw new ValidationError(scheduleError)

              const golesLocal = (data.golesLocal ?? lockedCtx.golesLocal) as number
              const golesVisitante = (data.golesVisitante ?? lockedCtx.golesVisitante) as number
              const penalesLocal = data.penalesLocal !== undefined ? (data.penalesLocal as number | null) : lockedCtx.penalesLocal
              const penalesVisitante = data.penalesVisitante !== undefined ? (data.penalesVisitante as number | null) : lockedCtx.penalesVisitante
              if (golesLocal === golesVisitante && (penalesLocal == null || penalesVisitante == null || penalesLocal === penalesVisitante)) {
                throw new ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.')
              }
            }
            const playoffData = data.estado === 'PROGRAMADO'
              ? { ...data, golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null, version: { increment: 1 } }
              : data.estado ? { ...data, version: { increment: 1 } } : data
            const partido = await partidoRepository.update(id, playoffData, tx)
            if (data.estado === 'PROGRAMADO') {
              await tx.anotacionPartido.deleteMany({ where: { partidoId: id } })
              await tx.participacionPartido.deleteMany({ where: { partidoId: id } })
            }
            await rondaPlayoffService.syncAdvancement(tx, lockedCtx.rondaPlayoffId)
            return partido
          }, { isolationLevel: 'Serializable' })
        } catch (error: any) {
          if (error?.code === 'P2034' && attempt < 2) continue
          if (error?.code === 'P2034') throw new ConflictError('El cuadro de playoff cambió durante la actualización; vuelve a intentarlo')
          throw error
        }
      }
      throw new ConflictError('El cuadro de playoff cambió durante la actualización; vuelve a intentarlo')
    }

    if (ctx.jornadaId && !ctx.rondaPlayoffId) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            await acquireLeagueScheduleLock(tx, ctx.ligaId)
            const lockedCtx = await partidoRepository.findAuthorizationContext(id, tx)
            if (!lockedCtx) throw new NotFoundError('Partido')
            assertOwnerOrAdmin(actor, lockedCtx.ligaUserId, 'Partido')
            if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
              throw new ConflictError('El partido cambió durante la actualización; vuelve a intentarlo')
            }
            if (lockedCtx.estado === 'FINALIZADO') {
              const allowedTargets = ['SUSPENDIDO', 'PROGRAMADO']
              if (!allowedTargets.includes(data.estado as string)) {
                throw new ValidationError('No se puede modificar un partido ya finalizado')
              }
            }

            const transactionalData = { ...data }
            if (transactionalData.estado === 'PROGRAMADO') {
              transactionalData.golesLocal = 0
              transactionalData.golesVisitante = 0
              transactionalData.penalesLocal = null
              transactionalData.penalesVisitante = null
            }
            if (transactionalData.estado) transactionalData.version = { increment: 1 }
            const partido = await partidoRepository.update(id, transactionalData, tx)
            if (transactionalData.estado === 'PROGRAMADO') {
              await tx.anotacionPartido.deleteMany({ where: { partidoId: id } })
              await tx.participacionPartido.deleteMany({ where: { partidoId: id } })
            }
            if ((lockedCtx.estado === 'FINALIZADO' || partido.estado === 'FINALIZADO') && partido.jornadaId) {
              await this._recalcularDivision(partido.jornadaId, tx)
            }
            return partido
          }, { isolationLevel: 'Serializable' })
        } catch (error: any) {
          if (error?.code === 'P2034' && attempt < 2) continue
          throw error
        }
      }
    }

    return this._applyResult(id, data, ctx)
  },

  async updateResult(id: string, data: ResultInput, actor: AuthenticatedUser) {
    const initial = await partidoRepository.findAuthorizationContext(id)
    if (!initial) throw new NotFoundError('Partido')
    assertOwnerOrAdmin(actor, initial.ligaUserId, 'Partido')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          await acquireLeagueScheduleLock(tx, initial.ligaId)
          const locked = await partidoRepository.findAuthorizationContext(id, tx)
          if (!locked) throw new NotFoundError('Partido')
          assertOwnerOrAdmin(actor, locked.ligaUserId, 'Partido')
          if (locked.ligaId !== initial.ligaId) throw new ConflictError('El partido cambió durante la actualización; vuelve a intentarlo')
          return writeResultInTransaction(tx, id, data)
        }, { isolationLevel: 'ReadCommitted' })
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) continue
        if (error?.code === 'P2034') throw new ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo')
        throw error
      }
    }
    throw new ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo')
  },

  async _applyResult(id: string, data: Record<string, unknown>, ctx: { id: string; ligaUserId: string; estado: string | null; golesLocal: number; golesVisitante: number; penalesLocal: number | null; penalesVisitante: number | null; jornadaId: string | null; rondaPlayoffId: string | null }): Promise<PartidoEntity> {
    if (data.estado === 'FINALIZADO' && ctx.rondaPlayoffId) {
      const golesLocal = (data.golesLocal ?? ctx.golesLocal) as number
      const golesVisitante = (data.golesVisitante ?? ctx.golesVisitante) as number
      const penalesLocal = data.penalesLocal !== undefined ? (data.penalesLocal as number | null) : ctx.penalesLocal
      const penalesVisitante = data.penalesVisitante !== undefined ? (data.penalesVisitante as number | null) : ctx.penalesVisitante

      if (golesLocal === golesVisitante) {
        if (penalesLocal == null || penalesVisitante == null || penalesLocal === penalesVisitante) {
          throw new ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.')
        }
      }
    }

    const oldEstado = ctx.estado
    if (oldEstado === 'FINALIZADO' && data.estado === 'PROGRAMADO') {
      data.golesLocal = 0
      data.golesVisitante = 0
      data.penalesLocal = null
      data.penalesVisitante = null
    }

    const partido = await partidoRepository.update(id, data);

    const wasFinalizado = oldEstado === 'FINALIZADO';
    const nowFinalizado = partido.estado === 'FINALIZADO';

    if ((nowFinalizado || wasFinalizado) && partido.jornadaId) {
      await this._recalcularDivision(partido.jornadaId);
    }

    return partido;
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<PartidoEntity> {
    const ctx = await partidoRepository.findAuthorizationContext(id);
    if (!ctx) throw new NotFoundError('Partido');
    assertOwnerOrAdmin(actor, ctx.ligaUserId, 'Partido');

    if (ctx.rondaPlayoffId) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            await acquireLeagueScheduleLock(tx, ctx.ligaId)
            const lockedCtx = await partidoRepository.findAuthorizationContext(id, tx)
            if (!lockedCtx) throw new NotFoundError('Partido')
            assertOwnerOrAdmin(actor, lockedCtx.ligaUserId, 'Partido')
            if (!lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
              throw new ConflictError('El partido cambió durante la eliminación; vuelve a intentarlo')
            }
            const partido = await partidoRepository.delete(id, tx)
            await rondaPlayoffService.syncAdvancement(tx, lockedCtx.rondaPlayoffId)
            return partido
          }, { isolationLevel: 'Serializable' })
        } catch (error: any) {
          if (error?.code === 'P2034' && attempt < 2) continue
          if (error?.code === 'P2034') throw new ConflictError('El cuadro de playoff cambió durante la eliminación; vuelve a intentarlo')
          throw error
        }
      }
      throw new ConflictError('El cuadro de playoff cambió durante la eliminación; vuelve a intentarlo')
    }

    if (ctx.jornadaId && !ctx.rondaPlayoffId) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (tx) => {
            await acquireLeagueScheduleLock(tx, ctx.ligaId)
            const lockedCtx = await partidoRepository.findAuthorizationContext(id, tx)
            if (!lockedCtx) throw new NotFoundError('Partido')
            assertOwnerOrAdmin(actor, lockedCtx.ligaUserId, 'Partido')
            if (!lockedCtx.jornadaId || lockedCtx.rondaPlayoffId || lockedCtx.ligaId !== ctx.ligaId) {
              throw new ConflictError('El partido cambió durante la eliminación; vuelve a intentarlo')
            }
            const partido = await partidoRepository.delete(id, tx)
            if (lockedCtx.estado === 'FINALIZADO') {
              await this._recalcularDivision(lockedCtx.jornadaId, tx)
            }
            return partido
          }, { isolationLevel: 'Serializable' })
        } catch (error: any) {
          if (error?.code === 'P2034' && attempt < 2) continue
          throw error
        }
      }
    }

    return partidoRepository.delete(id);
  },

  async _recalcularDivision(jornadaId: string, tx?: import('../../generated/prisma/client').Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma
    const jornada = await client.jornada.findUnique({ where: { id: jornadaId }, select: { divisionId: true } });
    if (jornada) {
      await tablaPosicionService.recalcular(jornada.divisionId, tx);
    }
  },
};

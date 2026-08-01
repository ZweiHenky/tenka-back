import { prisma } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { partidoRepository } from './repository';
import { tablaPosicionService } from '../tabla-posicion/service';
import { rondaPlayoffService } from '../ronda-playoff/service';
import type { PartidoEntity } from './entity';

const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

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
    if (data.jornadaId !== undefined || data.rondaPlayoffId !== undefined) {
      await assertParentOwner(data.jornadaId as string | undefined, data.rondaPlayoffId as string | undefined, actor)
    }
    if (ctx.estado === 'FINALIZADO') {
      const allowedTargets = ctx.rondaPlayoffId ? ['SUSPENDIDO'] : ['SUSPENDIDO', 'PROGRAMADO']
      if (!allowedTargets.includes(data.estado as string)) {
        throw new ValidationError('No se puede modificar un partido ya finalizado')
      }
    }

    const replacesLocal = data.equipoLocalId !== undefined
    const replacesVisitor = data.equipoVisitanteId !== undefined
    if (replacesLocal || replacesVisitor) {
      if (replacesLocal && replacesVisitor) {
        throw new ValidationError('Solo se puede intercambiar un equipo por solicitud')
      }
      if (ctx.estado !== 'PROGRAMADO') {
        throw new ValidationError('Solo se pueden reemplazar equipos en partidos programados')
      }
      if (!ctx.jornadaId || ctx.rondaPlayoffId || !ctx.divisionId || ctx.tipoPartido !== 'REGULAR') {
        throw new ValidationError('Solo se pueden reemplazar equipos en partidos regulares de jornada')
      }

      const incomingId = (replacesLocal ? data.equipoLocalId : data.equipoVisitanteId) as string
      const outgoingId = replacesLocal ? ctx.equipoLocalId : ctx.equipoVisitanteId
      if (!incomingId || !outgoingId) {
        throw new ValidationError('Los equipos del intercambio son obligatorios')
      }
      const equipoLocalId = replacesLocal ? incomingId : ctx.equipoLocalId
      const equipoVisitanteId = replacesVisitor ? incomingId : ctx.equipoVisitanteId
      if (equipoLocalId === equipoVisitanteId) {
        throw new ValidationError('El equipo local y visitante deben ser diferentes')
      }

      const linkedTeams = await prisma.divisionEquipo.count({
        where: { divisionId: ctx.divisionId, equipoId: incomingId },
      })
      if (linkedTeams !== 1) {
        throw new ValidationError('El equipo de reemplazo no pertenece a la división de la jornada')
      }

      const targets = await prisma.partido.findMany({
        where: {
          id: { not: id },
          jornadaId: ctx.jornadaId,
          rondaPlayoffId: null,
          tipoPartido: 'REGULAR',
          OR: [{ equipoLocalId: incomingId }, { equipoVisitanteId: incomingId }],
        },
        select: {
          id: true, estado: true, fecha: true, fechaFin: true,
          equipoLocalId: true, equipoVisitanteId: true,
        },
      })
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

      const intervals = [
        { teamId: incomingId, start: data.fecha !== undefined ? new Date(data.fecha as string) : ctx.fecha, end: data.fechaFin !== undefined ? new Date(data.fechaFin as string) : ctx.fechaFin },
        { teamId: outgoingId, start: target.fecha, end: target.fechaFin },
      ].filter((interval): interval is { teamId: string; start: Date; end: Date } => Boolean(interval.start && interval.end))
      if (intervals.length > 0) {
        const conflict = await prisma.partido.findFirst({
          where: {
            id: { notIn: [id, target.id] },
            AND: [
              {
                OR: [
                  { jornada: { divisionId: ctx.divisionId } },
                  { rondaPlayoff: { divisionId: ctx.divisionId } },
                ],
              },
              {
                OR: intervals.map((interval) => ({
                  fecha: { lt: interval.end },
                  fechaFin: { gt: interval.start },
                  OR: [
                    { equipoLocalId: interval.teamId },
                    { equipoVisitanteId: interval.teamId },
                  ],
                })),
              },
            ],
          },
          select: { id: true },
        })
        if (conflict) {
          throw new ValidationError('Uno de los equipos ya tiene un partido en el horario resultante')
        }
      }

      const targetData = target.equipoLocalId === incomingId
        ? { equipoLocalId: outgoingId }
        : { equipoVisitanteId: outgoingId }

      return prisma.$transaction(async (tx) => {
        const jornadas = await tx.jornada.findMany({
          where: { divisionId: ctx.divisionId! },
          orderBy: { numero: 'asc' },
          select: {
            id: true,
            numero: true,
            partidos: {
              where: { rondaPlayoffId: null, tipoPartido: 'REGULAR' },
              select: { id: true, estado: true, fecha: true, equipoLocalId: true, equipoVisitanteId: true },
            },
          },
        })
        const currentJornada = jornadas.find((jornada) => jornada.id === ctx.jornadaId)
        if (!currentJornada) throw new ValidationError('La jornada del partido ya no está disponible')

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
        const transactionalCurrent = currentJornada.partidos.find((partido) => partido.id === id)
        const transactionalTarget = currentJornada.partidos.find((partido) => partido.id === target.id)
        if (transactionalCurrent?.estado !== 'PROGRAMADO' || transactionalTarget?.estado !== 'PROGRAMADO') {
          throw new ValidationError('Los partidos del intercambio deben continuar programados')
        }
        if (
          transactionalCurrent.equipoLocalId !== ctx.equipoLocalId
          || transactionalCurrent.equipoVisitanteId !== ctx.equipoVisitanteId
          || transactionalTarget.equipoLocalId !== target.equipoLocalId
          || transactionalTarget.equipoVisitanteId !== target.equipoVisitanteId
        ) {
          throw new ValidationError('Los participantes de los partidos del intercambio cambiaron; vuelve a intentarlo')
        }
        const currentPairs = new Set<string>()
        for (const partido of currentJornada.partidos) {
          let local = partido.equipoLocalId
          let visitante = partido.equipoVisitanteId
          if (partido.id === id) local = replacesLocal ? incomingId : local, visitante = replacesVisitor ? incomingId : visitante
          if (partido.id === target.id) local = targetData.equipoLocalId ?? local, visitante = targetData.equipoVisitanteId ?? visitante
          if (!local || !visitante || local === visitante) throw new ValidationError('La jornada actual contiene partidos regulares incompletos o inválidos')
          const key = pairKey(local, visitante)
          if (currentPairs.has(key)) throw new ValidationError('El intercambio produciría un enfrentamiento duplicado dentro de la jornada actual')
          currentPairs.add(key)
          occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
        }

        const recalculated: Array<{ slots: typeof future[number]['partidos']; pairs: Array<[string, string]> }> = []
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
          for (const [local, visitante] of pairs) {
            const key = pairKey(local, visitante)
            occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
          }
          recalculated.push({ slots, pairs })
        }

        const scheduleWrites = [
          tx.partido.update({ where: { id: target.id }, data: targetData }),
          ...recalculated.flatMap((jornada) => jornada.slots.map((slot, index) => tx.partido.update({
            where: { id: slot.id },
            data: { equipoLocalId: jornada.pairs[index][0], equipoVisitanteId: jornada.pairs[index][1] },
          }))),
        ]
        const [, updated] = await Promise.all([
          Promise.all(scheduleWrites),
          tx.partido.update({
            where: { id }, data,
            include: {
              equipoLocal: { select: { id: true, nombre: true, logo: true } },
              equipoVisitante: { select: { id: true, nombre: true, logo: true } },
              cancha: { select: { id: true, nombre: true } },
              arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
            },
          }),
        ])
        return { ...updated, arbitros: updated.arbitros?.map((row: any) => row.arbitro), jornadasRecalculadas: recalculated.length } as PartidoEntity
      })
    }

    return this._applyResult(id, data, ctx)
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

    if (nowFinalizado && partido.rondaPlayoffId) {
      await rondaPlayoffService.advanceWinners(partido.rondaPlayoffId);
    }

    return partido;
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const ctx = await partidoRepository.findAuthorizationContext(id);
    if (!ctx) throw new NotFoundError('Partido');
    assertOwnerOrAdmin(actor, ctx.ligaUserId, 'Partido');
    await partidoRepository.delete(id);
    if (ctx.estado === 'FINALIZADO' && ctx.jornadaId) {
      await this._recalcularDivision(ctx.jornadaId);
    }
  },

  async _recalcularDivision(jornadaId: string): Promise<void> {
    const jornada = await prisma.jornada.findUnique({ where: { id: jornadaId }, select: { divisionId: true } });
    if (jornada) {
      await tablaPosicionService.recalcular(jornada.divisionId);
    }
  },
};

import { NotFoundError, ValidationError } from '../../utils/errors';
import { jornadaRepository } from './repository';
import { tablaPosicionService } from '../tabla-posicion/service';
import { notificationService } from '../notification/service';
import { prisma } from '../../config/database';
import type { JornadaEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';

async function assertDivisionOwner(divisionId: string, actor: AuthenticatedUser): Promise<void> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { liga: { select: { userId: true } } },
  });
  if (!division) throw new NotFoundError('División');
  assertOwnerOrAdmin(actor, division.liga.userId, 'División');
}

const DAY_MAP: Record<string, number> = {
  dom: 0, domingo: 0,
  lun: 1, lunes: 1,
  mar: 2, martes: 2,
  mie: 3, miercoles: 3,
  jue: 4, jueves: 4,
  vie: 5, viernes: 5,
  sab: 6, sabado: 6,
};

function tomorrowDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function isOverlapping(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function parseDaysPartido(text: string | null): number[] {
  if (!text) return [];
  const parts = text.toLowerCase().replace(/[y\/]/g, ',').split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  const days = new Set<number>();
  for (const part of parts) {
    const range = part.split(/\s*a\s*/);
    if (range.length === 2) {
      const a = DAY_MAP[range[0].slice(0, 3)] ?? DAY_MAP[range[0]];
      const b = DAY_MAP[range[1].slice(0, 3)] ?? DAY_MAP[range[1]];
      if (a !== undefined && b !== undefined) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let d = start; d <= end; d++) days.add(d);
      }
    } else {
      const d = DAY_MAP[part.slice(0, 3)] ?? DAY_MAP[part];
      if (d !== undefined) days.add(d);
    }
  }
  return [...days].sort();
}

interface SlotInput {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  equipoLocalId?: string;
  equipoVisitanteId?: string;
  tipo?: 'regular' | 'complemento' | 'amistoso' | 'eliminatoria';
  canchaId?: string;
  partidoId?: string;
}

function getSlotInterval(slot: SlotInput): { start: Date; end: Date } | null {
  const dateMatch = slot.fecha?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startMatch = slot.horaInicio?.match(/^(\d{2}):(\d{2})$/);
  const endMatch = slot.horaFin?.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !startMatch || !endMatch) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const start = new Date(year, month - 1, day, Number(startMatch[1]), Number(startMatch[2]));
  const end = new Date(year, month - 1, day, Number(endMatch[1]), Number(endMatch[2]));
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

function buildHistoricalMatchCounts(existing: Array<{ partidos: Array<{ equipoLocalId: string | null; equipoVisitanteId: string | null; tipoPartido: string }> }>, tipoPartido: 'REGULAR' | 'AMISTOSO'): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const jornada of existing) {
    for (const p of jornada.partidos) {
      if (!p.equipoLocalId || !p.equipoVisitanteId) continue;
      if (p.tipoPartido !== tipoPartido) continue;
      const [a, b] = p.equipoLocalId < p.equipoVisitanteId
        ? [p.equipoLocalId, p.equipoVisitanteId]
        : [p.equipoVisitanteId, p.equipoLocalId];
      let inner = counts.get(a);
      if (!inner) { inner = new Map(); counts.set(a, inner); }
      inner.set(b, (inner.get(b) || 0) + 1);
    }
  }
  return counts;
}

function getMatchCount(counts: Map<string, Map<string, number>>, a: string, b: string): number {
  const [keyA, keyB] = a < b ? [a, b] : [b, a];
  return counts.get(keyA)?.get(keyB) ?? 0;
}

function computeRRPairing(
  sorted: Array<{ id: string; nombre: string }>,
  round: number,
): Map<string, string> {
  const pairing = new Map<string, string>();
  if (sorted.length < 2) return pairing;

  const pool = [...sorted];
  if (pool.length % 2 !== 0) {
    pool.push({ id: 'DESCANSO', nombre: 'Descanso' });
  }

  const n = pool.length;
  const fixed = pool[0];
  const rotators = pool.slice(1);
  const r = round % (n - 1);

  pairing.set(fixed.id, rotators[r].id);
  pairing.set(rotators[r].id, fixed.id);

  for (let m = 1; m < n / 2; m++) {
    const idxA = (r + m) % rotators.length;
    const idxB = (r + rotators.length - m) % rotators.length;
    const a = rotators[idxA].id;
    const b = rotators[idxB].id;
    pairing.set(a, b);
    pairing.set(b, a);
  }

  return pairing;
}

export const jornadaService = {
  async list(actor?: AuthenticatedUser): Promise<JornadaEntity[]> {
    return prisma.jornada.findMany({ where: { division: visibleDivisionWhere(actor) } });
  },

  async getById(id: string, actor?: AuthenticatedUser): Promise<JornadaEntity> {
    const t = await jornadaRepository.findVisibleById(id, actor);
    if (!t) throw new NotFoundError('Jornada');
    return t;
  },

  async findByDivision(divisionId: string, options?: { skip?: number; take?: number }, actor?: AuthenticatedUser) {
    const result = await jornadaRepository.findVisibleByDivision(divisionId, options, actor);
    if (!result) throw new NotFoundError('División');
    return result;
  },

  async create(data: { numero: number; fechaInicio?: string; fechaFin?: string; divisionId: string }, actor: AuthenticatedUser): Promise<JornadaEntity> {
    await assertDivisionOwner(data.divisionId, actor);
    return jornadaRepository.create(data);
  },

  async update(id: string, data: Record<string, unknown>, actor: AuthenticatedUser): Promise<JornadaEntity> {
    const context = await jornadaRepository.findUpdateContext(id, actor);
    if (!context) throw new NotFoundError('Jornada');
    return jornadaRepository.update(id, data);
  },

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const context = await jornadaRepository.findDeleteContext(id, actor);
    if (!context) throw new NotFoundError('Jornada');
    if (context.latestJornadaId !== id) {
      throw new ValidationError('Solo se puede eliminar la última jornada generada');
    }
    const { divisionId, hasFinalizados, playoffPartidos } = context;

    await prisma.$transaction(async (tx) => {
      const partidosByRonda = new Map<string, typeof playoffPartidos>();
      for (const partido of playoffPartidos) {
        const rondaId = partido.rondaPlayoffId!;
        const current = partidosByRonda.get(rondaId) ?? [];
        current.push(partido);
        partidosByRonda.set(rondaId, current);
      }

      for (const [rondaId, partidos] of partidosByRonda) {
        const ronda = await tx.rondaPlayoff.findUnique({
          where: { id: rondaId },
          select: { divisionId: true, orden: true },
        });
        if (!ronda) continue;
        const nextRonda = await tx.rondaPlayoff.findFirst({
          where: { divisionId: ronda.divisionId, orden: ronda.orden + 1 },
          select: { id: true },
        });
        if (!nextRonda) continue;

        const nextKeys = [...new Set(partidos.map((p) => Math.ceil(p.llave! / 2)))];
        const derivedPartidos = await tx.partido.findMany({
          where: { rondaPlayoffId: nextRonda.id, llave: { in: nextKeys } },
          select: { id: true, jornadaId: true },
        });
        const assignedToAnotherJornada = derivedPartidos.find((p) => p.jornadaId && p.jornadaId !== id);
        if (assignedToAnotherJornada) {
          throw new ValidationError('No se puede eliminar la jornada porque la siguiente fase ya fue programada');
        }
        if (derivedPartidos.length > 0) {
          await tx.partido.deleteMany({ where: { id: { in: derivedPartidos.map((p) => p.id) } } });
        }
      }

      const playoffIds = playoffPartidos.map((p) => p.id);
      if (playoffIds.length > 0) {
        await tx.partidoRefereeAccess.deleteMany({ where: { partidoId: { in: playoffIds } } });
        await tx.partido.updateMany({
          where: { id: { in: playoffIds } },
          data: {
            estado: 'PROGRAMADO',
            golesLocal: 0,
            golesVisitante: 0,
            penalesLocal: null,
            penalesVisitante: null,
            fecha: null,
            fechaFin: null,
            canchaId: null,
            jornadaId: null,
          },
        });
      }

      await tx.jornada.delete({ where: { id } });
    });
    if (hasFinalizados) {
      await tablaPosicionService.recalcular(divisionId);
    }
  },

  async generateNext(divisionId: string, actor: AuthenticatedUser, slots?: SlotInput[], equipoIds?: string[], descansoEquipoId?: string): Promise<JornadaEntity> {
    const startedAt = Date.now();
    const division = await prisma.division.findUnique({
      where: { id: divisionId },
      select: {
        diasPartido: true,
        duracionPartido: true,
        ligaId: true,
        liga: { select: { userId: true } },
      },
    });
    if (!division) throw new NotFoundError('División');
    assertOwnerOrAdmin(actor, division.liga.userId, 'División');

    // Check for playoff mode: when rondas exist, only amistoso and eliminatoria slots allowed
    const playoffRound = await prisma.rondaPlayoff.findFirst({ where: { divisionId }, select: { id: true } });
    const playoffMode = playoffRound !== null;
    if (playoffMode) {
      if (slots) {
        for (const s of slots) {
          if (s.tipo === 'regular' || s.tipo === 'complemento') {
            throw new ValidationError('No se permiten partidos regulares o de complemento cuando hay eliminatorias');
          }
        }
      }
      if (descansoEquipoId) {
        throw new ValidationError('No se permite equipo que descansa cuando hay eliminatorias');
      }
    }

    const existing = await jornadaRepository.findGenerationHistory(divisionId);
    const nextNumero = existing.length > 0 ? Math.max(...existing.map(j => j.numero)) + 1 : 1;

    const links = await prisma.divisionEquipo.findMany({
      where: { divisionId },
      include: { equipo: { select: { id: true, nombre: true } } },
    });

    const allTeams = links.map((l) => ({ id: l.equipo.id, nombre: l.equipo.nombre }));
    const teams = equipoIds
      ? allTeams.filter((t) => equipoIds.includes(t.id))
      : allTeams;

    if (teams.length < 2) throw new ValidationError('Se necesitan al menos 2 equipos');

    const teamIds = new Set(teams.map((t) => t.id));

    // Determine reference date from last jornada's fechaInicio
    let weekStart: Date | null = null;
    if (existing.length > 0) {
      const lastJornada = existing.reduce((a, b) => (a.numero > b.numero ? a : b));
      if (lastJornada.fechaInicio) {
        weekStart = new Date(lastJornada.fechaInicio);
        weekStart.setDate(weekStart.getDate() + 7);
      } else {
        const lastFecha = lastJornada.partidos
          .map((partido) => partido.fecha)
          .filter((fecha): fecha is Date => fecha !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0];
        if (lastFecha) {
          weekStart = new Date(lastFecha);
          weekStart.setDate(weekStart.getDate() + 7);
        }
      }
    }
    const pendingPlayoffUpdates: Array<{
      id: string;
      data: Record<string, unknown>;
    }> = [];
    let playoffCount = 0;

      // Parse division's diasPartido into day numbers for date distribution
      const parsedDays = parseDaysPartido(division.diasPartido);

      // Process eliminatoria slots: update fecha on unscheduled ronda-playoff partidos
      // and collect teams to exclude from regular pool
      const usedTeamIds = new Set<string>();
      const eliminatoriaTeamIds = new Set<string>();
      const eliminatoriaPairKeys = new Set<string>();
      const eliminatoriaIds = [...new Set((slots ?? [])
        .filter((slot) => slot.tipo === 'eliminatoria' && slot.partidoId)
        .map((slot) => slot.partidoId!))];
      const eliminatoriaPartidos = eliminatoriaIds.length > 0
        ? await prisma.partido.findMany({
          where: { id: { in: eliminatoriaIds } },
          select: {
            id: true,
            equipoLocalId: true,
            equipoVisitanteId: true,
            jornadaId: true,
          },
        })
        : [];
      const eliminatoriaById = new Map(eliminatoriaPartidos.map((partido) => [partido.id, partido]));
      if (slots && slots.length > 0) {
        for (const slot of slots) {
          if (slot.tipo !== 'eliminatoria' || !slot.partidoId) continue;

          const existing = eliminatoriaById.get(slot.partidoId);
          if (!existing) throw new ValidationError(`El partido de eliminatoria ${slot.partidoId} no existe`);
          if (existing?.jornadaId) {
            continue;
          }

          playoffCount++;

          // Collect participants from authoritative match data (not just frontend slot)
          const matchLocalId = existing?.equipoLocalId ?? undefined;
          const matchVisitanteId = existing?.equipoVisitanteId ?? undefined;
          if (matchLocalId && teamIds.has(matchLocalId)) eliminatoriaTeamIds.add(matchLocalId);
          if (matchVisitanteId && teamIds.has(matchVisitanteId)) eliminatoriaTeamIds.add(matchVisitanteId);
          if (matchLocalId && matchVisitanteId) {
            eliminatoriaPairKeys.add([matchLocalId, matchVisitanteId].sort().join('-'));
          }

          const timeMatch = slot.horaInicio?.match(/^(\d{2}):(\d{2})/);
          const h = timeMatch ? Number(timeMatch[1]) : 0;
          const m = timeMatch ? Number(timeMatch[2]) : 0;
          if (slot.fecha) {
            const fechaMatch = slot.fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (fechaMatch) {
              const fecha = new Date(Number(fechaMatch[1]), Number(fechaMatch[2]) - 1, Number(fechaMatch[3]), h, m);
              if (fecha < tomorrowDate()) {
                throw new ValidationError(`La fecha del partido de eliminatoria ${slot.partidoId} (${slot.fecha}) no puede ser antes de mañana`);
              }
              const fechaFinPlayoff = division.duracionPartido ? addMinutes(fecha, division.duracionPartido) : undefined;
              pendingPlayoffUpdates.push({
                id: slot.partidoId,
                data: {
                  fecha,
                  fechaFin: fechaFinPlayoff || null,
                  canchaId: slot.canchaId || null,
                },
              });
            }
          }

          if (slot.equipoLocalId && teamIds.has(slot.equipoLocalId)) eliminatoriaTeamIds.add(slot.equipoLocalId);
          if (slot.equipoVisitanteId && teamIds.has(slot.equipoVisitanteId)) eliminatoriaTeamIds.add(slot.equipoVisitanteId);
        }
      }
      for (const id of eliminatoriaTeamIds) usedTeamIds.add(id);

      const regularTeamCount = teams.length - eliminatoriaTeamIds.size;
      const teamLimited = Math.max(0, Math.ceil(regularTeamCount / 2));
      let maxPartidos = Math.max(0, teamLimited - playoffCount);

      // Without configured courts, all submitted slots share one virtual court.
      if (slots && slots.length > 1) {
        const noCanchaSlots = slots.filter((slot) => !slot.canchaId);
        for (let i = 0; i < noCanchaSlots.length; i++) {
          const current = getSlotInterval(noCanchaSlots[i]);
          if (!current) throw new ValidationError(`El horario ${noCanchaSlots[i].fecha} ${noCanchaSlots[i].horaInicio}-${noCanchaSlots[i].horaFin} no es válido`);
          for (let j = i + 1; j < noCanchaSlots.length; j++) {
            const other = getSlotInterval(noCanchaSlots[j]);
            if (!other) throw new ValidationError(`El horario ${noCanchaSlots[j].fecha} ${noCanchaSlots[j].horaInicio}-${noCanchaSlots[j].horaFin} no es válido`);
            if (isOverlapping(current.start, current.end, other.start, other.end)) {
              throw new ValidationError(
                `Hay partidos con horarios solapados (${noCanchaSlots[i].fecha} ${noCanchaSlots[i].horaInicio}-${noCanchaSlots[i].horaFin})`
              );
            }
          }
        }
      }

      // Validate cancha overlap across every match type and division
      if (slots && slots.length > 0) {
        const canchaSlots = slots.filter((s) => s.canchaId && s.fecha);
        if (canchaSlots.length > 0) {
          const canchaIds = [...new Set(canchaSlots.map((s) => s.canchaId!))];
          const incomingPartidoIds = canchaSlots.flatMap((s) => s.partidoId ? [s.partidoId] : []);
          const [existingPartidos, canchas] = await Promise.all([
            prisma.partido.findMany({
              where: {
                canchaId: { in: canchaIds },
                fecha: { not: null },
                fechaFin: { not: null },
                ...(incomingPartidoIds.length > 0 ? { id: { notIn: incomingPartidoIds } } : {}),
              },
              select: { id: true, canchaId: true, fecha: true, fechaFin: true },
            }),
            prisma.ligaCancha.findMany({
              where: { id: { in: canchaIds } },
              select: { id: true, nombre: true },
            }),
          ]);
          const canchaMap = new Map(canchas.map((c) => [c.id, c.nombre]));

          for (let i = 0; i < canchaSlots.length; i++) {
            const slot = canchaSlots[i];
            const interval = getSlotInterval(slot);
            if (!interval) throw new ValidationError(`El horario ${slot.fecha} ${slot.horaInicio}-${slot.horaFin} no es válido`);

            for (let j = i + 1; j < canchaSlots.length; j++) {
              const other = canchaSlots[j];
              if (other.canchaId !== slot.canchaId) continue;
              const otherInterval = getSlotInterval(other);
              if (!otherInterval) throw new ValidationError(`El horario ${other.fecha} ${other.horaInicio}-${other.horaFin} no es válido`);
              if (isOverlapping(interval.start, interval.end, otherInterval.start, otherInterval.end)) {
                const canchaNombre = canchaMap.get(slot.canchaId!) || slot.canchaId!;
                throw new ValidationError(
                  `La cancha "${canchaNombre}" tiene partidos con horarios solapados (${slot.fecha} ${slot.horaInicio}-${slot.horaFin})`
                );
              }
            }

            const conflict = existingPartidos.find((ep) => {
              if (ep.canchaId !== slot.canchaId) return false;
              return isOverlapping(interval.start, interval.end, ep.fecha!, ep.fechaFin!);
            });
            if (conflict) {
              const canchaNombre = canchaMap.get(slot.canchaId!) || slot.canchaId!;
              throw new ValidationError(
                `La cancha "${canchaNombre}" ya tiene otro partido programado en ese horario (${slot.fecha} ${slot.horaInicio}-${slot.horaFin})`
              );
            }
          }
        }
      }

      // Structure: each entry can be assigned teams or empty
      type PartidoPlan = { localId?: string; visitaId?: string; fecha?: Date; tipo?: 'regular' | 'complemento' | 'amistoso'; canchaId?: string };
      const plan: PartidoPlan[] = [];

      let usableSlots: SlotInput[] = [];
      if (slots && slots.length > 0) {
        const coreSlots = slots.filter((s) => !s.tipo || s.tipo === 'regular');
        const specialSlots = slots.filter((s) => s.tipo === 'amistoso' || s.tipo === 'complemento');
        usableSlots = [...coreSlots.slice(0, maxPartidos), ...specialSlots];

        for (let i = 0; i < usableSlots.length; i++) {
          const slot = usableSlots[i];

          const timeMatch = slot.horaInicio?.match(/^(\d{2}):(\d{2})/);
          const h = timeMatch ? Number(timeMatch[1]) : 0;
          const m = timeMatch ? Number(timeMatch[2]) : 0;

          let fecha: Date | undefined;
          if (slot.fecha) {
            const fechaMatch = slot.fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (fechaMatch) {
              fecha = new Date(Number(fechaMatch[1]), Number(fechaMatch[2]) - 1, Number(fechaMatch[3]), h, m);
            }
          }
          if (!fecha && weekStart && parsedDays.length > 0) {
            const dayIdx = i % parsedDays.length;
            const weekOffset = Math.floor(i / parsedDays.length);
            fecha = new Date(weekStart);
            fecha.setDate(fecha.getDate() + (parsedDays[dayIdx] - weekStart.getDay()) + weekOffset * 7);
            fecha.setHours(h, m, 0, 0);
          }
          if (fecha && fecha < tomorrowDate()) {
            throw new ValidationError(`La fecha del slot #${i} (${slot.fecha || 'sin fecha'}) no puede ser antes de mañana`);
          }

            if (slot.tipo === 'amistoso' && !playoffMode && (!slot.equipoLocalId || slot.equipoLocalId === 'DESCANSO' || !slot.equipoVisitanteId || slot.equipoVisitanteId === 'DESCANSO')) {
              throw new ValidationError(`El slot amistoso #${i} debe tener ambos equipos asignados`);
            }
            if (slot.tipo === 'complemento' && (!slot.equipoLocalId || slot.equipoLocalId === 'DESCANSO')) {
              throw new ValidationError(`El slot de complemento #${i} debe tener al menos el equipo que obtiene puntos asignado`);
            }
            if (slot.tipo === 'complemento') {
              const localId = slot.equipoLocalId && slot.equipoLocalId !== 'DESCANSO' ? slot.equipoLocalId : undefined;
              const visitaId = slot.equipoVisitanteId && slot.equipoVisitanteId !== 'DESCANSO' ? slot.equipoVisitanteId : undefined;
              if (localId && !teamIds.has(localId)) throw new ValidationError('El equipo puntos no pertenece a esta división');
              if (localId) usedTeamIds.add(localId);
              plan.push({ localId, visitaId, fecha, tipo: 'complemento', canchaId: slot.canchaId });
            } else if (slot.tipo === 'amistoso') {
              const localId = slot.equipoLocalId && slot.equipoLocalId !== 'DESCANSO' ? slot.equipoLocalId : undefined;
              const visitaId = slot.equipoVisitanteId && slot.equipoVisitanteId !== 'DESCANSO' ? slot.equipoVisitanteId : undefined;
              if (localId && !teamIds.has(localId)) throw new ValidationError('El equipo local del amistoso no está habilitado en esta división');
              if (visitaId && !teamIds.has(visitaId)) throw new ValidationError('El equipo visitante del amistoso no está habilitado en esta división');
              if (localId && visitaId && localId === visitaId) throw new ValidationError('Un equipo no puede jugar un amistoso contra sí mismo');
              if (playoffMode && localId && visitaId) {
                const pairKey = [localId, visitaId].sort().join('-');
                if (eliminatoriaPairKeys.has(pairKey)) {
                  throw new ValidationError(`El amistoso #${i} repite el mismo cruce que un partido de eliminatoria`);
                }
              }
              plan.push({ localId, visitaId, fecha, tipo: 'amistoso', canchaId: slot.canchaId });
            } else if (slot.equipoLocalId && slot.equipoVisitanteId
                       && slot.equipoLocalId !== 'DESCANSO'
                       && slot.equipoVisitanteId !== 'DESCANSO') {
              if (!teamIds.has(slot.equipoLocalId)) throw new ValidationError('El equipo local no pertenece a esta división');
              if (!teamIds.has(slot.equipoVisitanteId)) throw new ValidationError('El equipo visitante no pertenece a esta división');
              if (slot.equipoLocalId === slot.equipoVisitanteId) throw new ValidationError('Un equipo no puede jugar contra sí mismo');
              if (usedTeamIds.has(slot.equipoLocalId)) throw new ValidationError('El equipo local ya está asignado a otro horario');
              if (usedTeamIds.has(slot.equipoVisitanteId)) throw new ValidationError('El equipo visitante ya está asignado a otro horario');
              plan.push({ localId: slot.equipoLocalId, visitaId: slot.equipoVisitanteId, fecha, canchaId: slot.canchaId });
              usedTeamIds.add(slot.equipoLocalId);
              usedTeamIds.add(slot.equipoVisitanteId);
            } else if ((slot.equipoLocalId && slot.equipoLocalId !== 'DESCANSO')
                       || (slot.equipoVisitanteId && slot.equipoVisitanteId !== 'DESCANSO')) {
              const localId = slot.equipoLocalId && slot.equipoLocalId !== 'DESCANSO' ? slot.equipoLocalId : undefined;
              const visitaId = slot.equipoVisitanteId && slot.equipoVisitanteId !== 'DESCANSO' ? slot.equipoVisitanteId : undefined;
              const teamId = localId || visitaId!;
              if (!teamIds.has(teamId)) throw new ValidationError('El equipo no pertenece a esta división');
              if (usedTeamIds.has(teamId)) throw new ValidationError('El equipo ya está asignado a otro horario');
              usedTeamIds.add(teamId);
              plan.push({ localId, visitaId, fecha, canchaId: slot.canchaId });
            } else {
              plan.push({ fecha, canchaId: slot.canchaId });
            }
        }
      } else {
        for (let i = 0; i < maxPartidos; i++) {
          plan.push({});
        }
      }

      const amistosoHistoricalCounts = buildHistoricalMatchCounts(existing, 'AMISTOSO');
      const amistosoPairKeys = new Set(eliminatoriaPairKeys);
      const amistosoTeamCounts = new Map<string, number>();
      const amistosoPlans = plan.filter((p) => p.tipo === 'amistoso');
      const minAvailableAmistosoCount = () => {
        let min = Infinity;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            const pairKey = [teams[i].id, teams[j].id].sort().join('-');
            if (amistosoPairKeys.has(pairKey)) continue;
            min = Math.min(min, getMatchCount(amistosoHistoricalCounts, teams[i].id, teams[j].id));
          }
        }
        return min;
      };
      for (const p of amistosoPlans) {
        for (const teamId of [p.localId, p.visitaId]) {
          if (teamId) amistosoTeamCounts.set(teamId, (amistosoTeamCounts.get(teamId) ?? 0) + 1);
        }
        if (!p.localId || !p.visitaId) continue;
        const pairKey = [p.localId, p.visitaId].sort().join('-');
        if (amistosoPairKeys.has(pairKey)) {
          throw new ValidationError('No se puede repetir la misma pareja en partidos amistosos o de eliminatoria');
        }
        const pairCount = getMatchCount(amistosoHistoricalCounts, p.localId, p.visitaId);
        const minCount = minAvailableAmistosoCount();
        if (minCount !== Infinity && pairCount > minCount) {
          throw new ValidationError('Este cruce amistoso ya se jugó; todavía hay parejas disponibles en el ciclo actual');
        }
        amistosoPairKeys.add(pairKey);
      }

      // Auto-fill empty/partial amistoso slots in playoff mode
      if (playoffMode) {
        const hasEmptyAmistosos = amistosoPlans.some((p) => !p.localId || !p.visitaId);
        if (hasEmptyAmistosos) {
          const sortedCandidates = [...teams].sort((a, b) => {
            const nameCmp = a.nombre.localeCompare(b.nombre);
            return nameCmp !== 0 ? nameCmp : a.id.localeCompare(b.id);
          });
          const candidateScore = (teamId: string) => ({
            count: amistosoTeamCounts.get(teamId) ?? 0,
            eliminatoria: eliminatoriaTeamIds.has(teamId) ? 1 : 0,
          });
          const orderedOpponents = (assignedId: string) => sortedCandidates
            .filter((t) => t.id !== assignedId && !amistosoPairKeys.has([assignedId, t.id].sort().join('-')))
            .sort((a, b) => {
              const sa = candidateScore(a.id);
              const sb = candidateScore(b.id);
              const historyA = getMatchCount(amistosoHistoricalCounts, assignedId, a.id);
              const historyB = getMatchCount(amistosoHistoricalCounts, assignedId, b.id);
              if (historyA !== historyB) return historyA - historyB;
              if ((sa.count === 0) !== (sb.count === 0)) return sa.count === 0 ? -1 : 1;
              if (sa.eliminatoria !== sb.eliminatoria) return sa.eliminatoria - sb.eliminatoria;
              if (sa.count !== sb.count) return sa.count - sb.count;
              return a.nombre.localeCompare(b.nombre) || a.id.localeCompare(b.id);
            });

          for (const p of amistosoPlans) {
            if (p.localId && p.visitaId) continue;

            if (p.localId) {
              const assigned = p.localId;
              const opponent = orderedOpponents(assigned)[0];
              if (!opponent) throw new ValidationError('No hay combinaciones disponibles para completar los amistosos sin repetir parejas');
              p.visitaId = opponent.id;
              amistosoTeamCounts.set(opponent.id, (amistosoTeamCounts.get(opponent.id) ?? 0) + 1);
              amistosoPairKeys.add([assigned, opponent.id].sort().join('-'));
            } else if (p.visitaId) {
              const assigned = p.visitaId;
              const opponent = orderedOpponents(assigned)[0];
              if (!opponent) throw new ValidationError('No hay combinaciones disponibles para completar los amistosos sin repetir parejas');
              p.localId = opponent.id;
              amistosoTeamCounts.set(opponent.id, (amistosoTeamCounts.get(opponent.id) ?? 0) + 1);
              amistosoPairKeys.add([assigned, opponent.id].sort().join('-'));
            } else {
              const pairs: Array<{ local: typeof teams[number]; visita: typeof teams[number]; history: number; unused: number; count: number; eliminatoria: number }> = [];
              for (let i = 0; i < sortedCandidates.length; i++) {
                for (let j = i + 1; j < sortedCandidates.length; j++) {
                  const local = sortedCandidates[i];
                  const visita = sortedCandidates[j];
                  if (amistosoPairKeys.has([local.id, visita.id].sort().join('-'))) continue;
                  const localCount = amistosoTeamCounts.get(local.id) ?? 0;
                  const visitaCount = amistosoTeamCounts.get(visita.id) ?? 0;
                  pairs.push({
                    local,
                    visita,
                    history: getMatchCount(amistosoHistoricalCounts, local.id, visita.id),
                    unused: Number(localCount === 0) + Number(visitaCount === 0),
                    count: localCount + visitaCount,
                    eliminatoria: Number(eliminatoriaTeamIds.has(local.id)) + Number(eliminatoriaTeamIds.has(visita.id)),
                  });
                }
              }
              pairs.sort((a, b) =>
                a.history - b.history ||
                b.unused - a.unused ||
                a.eliminatoria - b.eliminatoria ||
                a.count - b.count ||
                a.local.nombre.localeCompare(b.local.nombre) ||
                a.visita.nombre.localeCompare(b.visita.nombre)
              );
              const selected = pairs[0];
              if (!selected) throw new ValidationError('No hay combinaciones disponibles para completar los amistosos sin repetir parejas');
              p.localId = selected.local.id;
              p.visitaId = selected.visita.id;
              amistosoTeamCounts.set(p.localId, (amistosoTeamCounts.get(p.localId) ?? 0) + 1);
              amistosoTeamCounts.set(p.visitaId, (amistosoTeamCounts.get(p.visitaId) ?? 0) + 1);
              amistosoPairKeys.add([p.localId, p.visitaId].sort().join('-'));
            }
          }
        }
      }

      // If a specific team was chosen to rest, exclude it from RR pool
      if (descansoEquipoId) {
        if (!teamIds.has(descansoEquipoId)) throw new ValidationError('El equipo seleccionado para descansar no pertenece a esta división');
        usedTeamIds.add(descansoEquipoId);
      }

      // Build historical match counts from existing jornadas (regular-only)
      const matchCounts = buildHistoricalMatchCounts(existing, 'REGULAR');

      // Sort teams deterministically for stable round-robin
      const sortedAllTeams = [...teams].sort((a, b) => a.id.localeCompare(b.id));

      // Precompute canonical round-robin pairings for this round number
      const regularRoundIndex = existing.filter((jornada) =>
        jornada.partidos?.some((partido) => partido.tipoPartido === 'REGULAR')
      ).length;
      const rrPairing = computeRRPairing(sortedAllTeams, regularRoundIndex);

      // Fill partially-filled slots (one side assigned) using RR pairings + history fallback
      for (const p of plan) {
        if (p.localId && p.visitaId) continue
        if (p.tipo === 'amistoso' || p.tipo === 'complemento') continue
        if (!p.localId && !p.visitaId) continue

        const teamId = p.localId || p.visitaId!;
        let opponentId = rrPairing.get(teamId);

        const available = teams.filter((t) => {
            if (t.id === teamId) return false;
            if (usedTeamIds.has(t.id)) return false;
            return true;
          });
        const minimumHistory = available.length
          ? Math.min(...available.map((team) => getMatchCount(matchCounts, teamId, team.id)))
          : Number.MAX_SAFE_INTEGER;
        // A manually changed prior round can invalidate the canonical rotation. Prefer any less-used pairing.
        if (!opponentId || usedTeamIds.has(opponentId) || opponentId === 'DESCANSO' || getMatchCount(matchCounts, teamId, opponentId) > minimumHistory) {
          if (available.length === 0) {
            throw new ValidationError('No hay equipos disponibles para completar los horarios');
          }
          available.sort((a, b) => {
            const ca = getMatchCount(matchCounts, teamId, a.id);
            const cb = getMatchCount(matchCounts, teamId, b.id);
            if (ca !== cb) return ca - cb;
            return a.id.localeCompare(b.id);
          });
          opponentId = available[0].id;
        }

        if (p.localId) {
          p.visitaId = opponentId;
        } else {
          p.localId = opponentId;
        }
        if (opponentId !== 'DESCANSO') {
          usedTeamIds.add(opponentId);
        }
      }

      // Fill empty slots using canonical RR pairings (same rotation as partial slots)
      const unassignedTeamList = teams
        .filter((t) => !usedTeamIds.has(t.id))
        .sort((a, b) => a.id.localeCompare(b.id));
      // In playoff mode, all teams are already accounted for in eliminatorias + amistosos
      if (playoffMode) unassignedTeamList.length = 0;

      for (const p of plan) {
        if (p.localId && p.visitaId) continue
        if (p.tipo === 'amistoso' || p.tipo === 'complemento') continue
        if (unassignedTeamList.length === 0) continue

        const teamId = unassignedTeamList.shift()!.id;
        let opponentId = rrPairing.get(teamId);

         const minimumHistory = unassignedTeamList.length
           ? Math.min(...unassignedTeamList.map((team) => getMatchCount(matchCounts, teamId, team.id)))
           : Number.MAX_SAFE_INTEGER;
         if (!opponentId || usedTeamIds.has(opponentId) || opponentId === 'DESCANSO' || getMatchCount(matchCounts, teamId, opponentId) > minimumHistory) {
           const available = unassignedTeamList.filter((t) => t.id !== teamId && t.id !== 'DESCANSO');
           if (available.length === 0) {
             opponentId = 'DESCANSO';
           } else {
            available.sort((a, b) => {
              const ca = getMatchCount(matchCounts, teamId, a.id);
              const cb = getMatchCount(matchCounts, teamId, b.id);
              if (ca !== cb) return ca - cb;
              return a.id.localeCompare(b.id);
            });
             opponentId = available[0].id;
             const idx = unassignedTeamList.findIndex((t) => t.id === opponentId);
             if (idx >= 0) unassignedTeamList.splice(idx, 1);
           }
         } else {
           const idx = unassignedTeamList.findIndex((t) => t.id === opponentId);
           if (idx >= 0) unassignedTeamList.splice(idx, 1);
        }

        p.localId = teamId;
        p.visitaId = opponentId;
        usedTeamIds.add(teamId);
        if (opponentId !== 'DESCANSO') {
          usedTeamIds.add(opponentId);
        }
      }

      // Extras: if some teams couldn't fit into plan slots, push new entries
      while (unassignedTeamList.length >= 2) {
        const a = unassignedTeamList.shift()!.id;
        let bId = rrPairing.get(a);
        const minimumHistory = unassignedTeamList.length
          ? Math.min(...unassignedTeamList.map((team) => getMatchCount(matchCounts, a, team.id)))
          : Number.MAX_SAFE_INTEGER;
        if (!bId || usedTeamIds.has(bId) || bId === 'DESCANSO' || getMatchCount(matchCounts, a, bId) > minimumHistory) {
          const next = [...unassignedTeamList]
            .filter((team) => team.id !== a && team.id !== 'DESCANSO')
            .sort((x, y) => getMatchCount(matchCounts, a, x.id) - getMatchCount(matchCounts, a, y.id) || x.id.localeCompare(y.id))[0];
          if (!next) break;
          bId = next.id;
        }
        const bIdx = unassignedTeamList.findIndex((t) => t.id === bId);
        if (bIdx >= 0) unassignedTeamList.splice(bIdx, 1);
        const pi = plan.length;
        let fecha: Date | undefined;
        if (weekStart && parsedDays.length > 0) {
          const dayIdx = pi % parsedDays.length;
          const weekOffset = Math.floor(pi / parsedDays.length);
          fecha = new Date(weekStart);
          fecha.setDate(fecha.getDate() + (parsedDays[dayIdx] - weekStart.getDay()) + weekOffset * 7);
        }
        if (!fecha && usableSlots.length > 0) {
          const refSlot = usableSlots[pi % usableSlots.length];
          const tMatch = refSlot.horaInicio?.match(/^(\d{2}):(\d{2})/);
          const hh = tMatch ? Number(tMatch[1]) : 0;
          const mm = tMatch ? Number(tMatch[2]) : 0;
          if (refSlot.fecha) {
            const fMatch = refSlot.fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (fMatch) {
              fecha = new Date(Number(fMatch[1]), Number(fMatch[2]) - 1, Number(fMatch[3]), hh, mm);
            }
          }
        }
        plan.push({ localId: a, visitaId: bId, fecha });
        usedTeamIds.add(a);
        usedTeamIds.add(bId);
      }

      if (unassignedTeamList.length > 0) {
        const last = unassignedTeamList[0];
        const pi = plan.length;
        let fecha: Date | undefined;
        if (weekStart && parsedDays.length > 0) {
          const dayIdx = pi % parsedDays.length;
          const weekOffset = Math.floor(pi / parsedDays.length);
          fecha = new Date(weekStart);
          fecha.setDate(fecha.getDate() + (parsedDays[dayIdx] - weekStart.getDay()) + weekOffset * 7);
        }
        plan.push({ localId: last.id, visitaId: 'DESCANSO', fecha });
        usedTeamIds.add(last.id);
      }

      // Fill empty side on complemento slots — Sin puntos puede ser cualquier equipo
      // (incluso uno que ya juega regular), solo se evita el pairing exacto duplicado
      const existingPairKeys = new Set<string>();
      for (const p of plan) {
        if (p.localId && p.visitaId) {
          existingPairKeys.add([p.localId, p.visitaId].sort().join('-'));
        }
      }
      for (const p of plan) {
        if (p.tipo !== 'complemento') continue
        if (p.localId && p.visitaId) continue
        if (!p.localId && !p.visitaId) continue
        if (p.localId && !p.visitaId) {
          const opponent = teams.find((t) => {
            if (t.id === p.localId) return false
            return !existingPairKeys.has([p.localId!, t.id].sort().join('-'))
          });
          if (!opponent) continue;
          p.visitaId = opponent.id;
          existingPairKeys.add([p.localId!, opponent.id].sort().join('-'));
        } else if (!p.localId && p.visitaId) {
          const opponent = teams.find((t) => {
            if (t.id === p.visitaId) return false
            return !existingPairKeys.has([t.id, p.visitaId!].sort().join('-'))
          });
          if (!opponent) continue;
          p.localId = opponent.id;
          existingPairKeys.add([opponent.id, p.visitaId!].sort().join('-'));
        }
      }

      // Move DESCANSO to the last non-amistoso real pairing, so regular slots stay filled
      const descansoIdx = plan.findIndex((p) => p.localId === 'DESCANSO' || p.visitaId === 'DESCANSO');
      let swapIdx = -1;
      for (let i = plan.length - 1; i > descansoIdx; i--) {
        const p = plan[i];
        if (p.tipo === 'amistoso') continue
        if (!p.localId || !p.visitaId) continue
        if (p.localId === 'DESCANSO' || p.visitaId === 'DESCANSO') continue
        swapIdx = i;
        break;
      }
      if (descansoIdx >= 0 && swapIdx > descansoIdx) {
        const a = plan[descansoIdx];
        const b = plan[swapIdx];
        const tL = a.localId, tV = a.visitaId;
        a.localId = b.localId;
        a.visitaId = b.visitaId;
        b.localId = tL;
        b.visitaId = tV;
      }

      // Dedup: skip duplicate pairings (A vs B and B vs A)
      const seenPairs = new Set<string>();
      const partidoData: Array<Record<string, unknown>> = [];

      for (const p of plan) {
        if (!p.localId || !p.visitaId) continue;
        if (p.localId === 'DESCANSO' || p.visitaId === 'DESCANSO') {
          continue;
        }
        const key = [p.localId, p.visitaId].sort().join('-');
        if (p.tipo !== 'amistoso' && seenPairs.has(key)) {
          continue;
        }
        seenPairs.add(key);

        const tipoPartido = p.tipo === 'amistoso' ? 'AMISTOSO' as const
          : p.tipo === 'complemento' ? 'COMPLEMENTO' as const
          : 'REGULAR' as const;

        const fechaFin = p.fecha && division.duracionPartido
          ? addMinutes(p.fecha, division.duracionPartido)
          : undefined;

        partidoData.push({
          golesLocal: 0,
          golesVisitante: 0,
          estado: 'PROGRAMADO',
          equipoLocalId: p.localId,
          equipoVisitanteId: p.visitaId,
          fecha: p.fecha || null,
          fechaFin: fechaFin || null,
          canchaId: p.canchaId || null,
          tipoPartido,
        });
      }

      // The transaction only persists the already-computed plan; provider work stays after commit.
      const fechas = [
        ...pendingPlayoffUpdates.map((update) => update.data.fecha),
        ...partidoData.map((partido) => partido.fecha),
      ].filter((fecha): fecha is Date => fecha instanceof Date);
      let fechaInicio: Date | undefined;
      let fechaFin: Date | undefined;
      if (fechas.length > 0) {
        const timestamps = fechas.map((d) => d.getTime());
        const minDate = new Date(Math.min(...timestamps));
        const maxDate = new Date(Math.max(...timestamps));
        fechaInicio = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate(), 0, 1, 0);
        fechaFin = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate(), 23, 59, 0);
      }

      const jornada = await prisma.$transaction(async (tx) => {
        const created = await tx.jornada.create({
          data: { numero: nextNumero, divisionId, fechaInicio, fechaFin },
        });
        for (const update of pendingPlayoffUpdates) {
          await tx.partido.update({
            where: { id: update.id },
            data: { ...update.data, jornadaId: created.id },
          });
        }
        if (partidoData.length > 0) {
          await tx.partido.createMany({
            data: partidoData.map((partido) => ({ ...partido, jornadaId: created.id })) as any,
          });
        }
        return created;
      });

    const updatedPlayoffIds = new Set(pendingPlayoffUpdates.map((update) => update.id));
    const createdPartidoCount = partidoData.length;

    logger.info({
      divisionId,
      jornadaId: jornada.id,
      counts: {
        created: createdPartidoCount,
        playoffUpdated: updatedPlayoffIds.size,
        total: createdPartidoCount + updatedPlayoffIds.size,
      },
      durationMs: Date.now() - startedAt,
    }, 'Jornada generation completed');

    void notificationService.notifyJornadaGenerated(jornada.id, divisionId, division.ligaId).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { provider: 'onesignal', operation: 'notify_jornada' } });
      logger.warn({ event: 'notification.failed', provider: 'onesignal', divisionId, jornadaId: jornada.id }, 'Jornada generation notification failed');
    });

    return jornada;
  },
};

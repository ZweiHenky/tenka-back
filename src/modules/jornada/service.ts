import { createHash, randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { jornadaRepository } from './repository';
import { tablaPosicionService } from '../tabla-posicion/service';
import { prisma } from '../../config/database';
import type { JornadaEntity } from './entity';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { visibleDivisionWhere } from '../../utils/divisionVisibility';
import { logger } from '../../config/logger';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import type { JornadaGenerationHistory } from './repository.interface';

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
  canchaId?: string | null;
  partidoId?: string;
}

class StaleGenerationPlanError extends Error {}

type GeneratedJornada = JornadaEntity & { idempotencyReplayed: boolean };

type GenerationLookupClient = {
  jornada: { findFirst(args: Record<string, unknown>): Promise<any> };
};

function generationRequestHash(slots?: SlotInput[], equipoIds?: string[], descansoEquipoId?: string): string {
  return createHash('sha256').update(JSON.stringify({
    slots: slots ?? null,
    equipoIds: equipoIds ? [...equipoIds].sort() : null,
    descansoEquipoId: descansoEquipoId ?? null,
  })).digest('hex');
}

function generationHistoryFingerprint(history: JornadaGenerationHistory[]): string {
  const canonicalHistory = history
    .map((jornada) => ({
      id: jornada.id,
      numero: jornada.numero,
      fechaInicio: jornada.fechaInicio?.toISOString() ?? null,
      partidos: jornada.partidos
        .map((partido) => ({
          id: partido.id,
          tipoPartido: partido.tipoPartido,
          equipoLocalId: partido.equipoLocalId,
          equipoVisitanteId: partido.equipoVisitanteId,
          fecha: partido.fecha?.toISOString() ?? null,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return createHash('sha256').update(JSON.stringify(canonicalHistory)).digest('hex');
}

async function findGenerationReplay(
  client: GenerationLookupClient,
  divisionId: string,
  generationKey: string,
  requestHash: string,
): Promise<JornadaEntity | null> {
  const existing = await client.jornada.findFirst({
    where: { divisionId, generationKey },
    select: { id: true, numero: true, fechaInicio: true, fechaFin: true, createdAt: true, updatedAt: true, divisionId: true, generationRequestHash: true },
  });
  if (!existing) return null;
  if (existing.generationRequestHash !== requestHash) {
    throw new ConflictError('La clave de idempotencia ya fue usada con una programación diferente');
  }
  const { generationRequestHash: _generationRequestHash, ...jornada } = existing;
  return jornada;
}

type CourtValidationClient = {
  ligaCancha: { findMany(args: Record<string, unknown>): Promise<Array<{ id: string; nombre: string; activa: boolean }>> };
  partido: { findMany(args: Record<string, unknown>): Promise<Array<{
    id: string;
    canchaId: string | null;
    fecha: Date | null;
    jornada: { division: { duracionPartido: number | null } } | null;
    rondaPlayoff: { division: { duracionPartido: number | null } } | null;
  }>> };
};

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

function getAuthoritativeSlotInterval(slot: SlotInput, durationMinutes: number | null): { start: Date; end: Date } {
  const submitted = getSlotInterval(slot);
  if (!submitted) {
    throw new ValidationError(`El horario ${slot.fecha} ${slot.horaInicio}-${slot.horaFin} no es válido`);
  }
  if (!durationMinutes || durationMinutes <= 0) {
    throw new ValidationError('La división debe tener una duración de partido válida para programar horarios');
  }

  const end = addMinutes(submitted.start, durationMinutes);
  if (end.getTime() !== submitted.end.getTime()) {
    throw new ValidationError(`La hora fin del horario ${slot.fecha} ${slot.horaInicio}-${slot.horaFin} no coincide con la duración de ${durationMinutes} minutos de la división`);
  }
  return { start: submitted.start, end };
}

function isCourtExclusionError(error: unknown): boolean {
  const candidate = error as any;
  const databaseError = candidate?.meta?.database_error ?? candidate?.cause?.meta?.database_error ?? candidate?.cause;
  const details = [
    candidate?.message,
    candidate?.meta?.constraint,
    candidate?.meta?.constraint_name,
    typeof databaseError === 'string' ? databaseError : undefined,
    databaseError?.message,
    databaseError?.code,
    databaseError?.constraint,
  ].filter(Boolean).join(' ');
  return candidate?.code === '23P01'
    || databaseError?.code === '23P01'
    || details.includes('partidos_cancha_no_overlap')
    || (candidate?.code === 'P2004' && /23P01|exclusion constraint/i.test(details));
}

async function validateLeagueCourtCapacity(
  client: CourtValidationClient,
  input: {
    ligaId: string;
    multiplesCanchas: boolean;
    durationMinutes: number | null;
    fixedCourtId?: string | null;
    slots: SlotInput[];
    excludedPartidoIds: string[];
  },
): Promise<void> {
  const canchas = await client.ligaCancha.findMany({
    where: { ligaId: input.ligaId, activa: true },
    select: { id: true, nombre: true, activa: true },
  });
  const activeNamed = canchas.filter((cancha) => cancha.nombre.trim().length > 0);
  if (input.multiplesCanchas && activeNamed.length < 2) {
    throw new ValidationError('Una liga con múltiples canchas requiere al menos 2 canchas activas con nombre');
  }

  const activeById = new Map(activeNamed.map((cancha) => [cancha.id, cancha.nombre]));
  if (input.fixedCourtId) {
    if (!input.multiplesCanchas) {
      throw new ValidationError('La liga no tiene múltiples canchas habilitadas');
    }
    if (!activeById.has(input.fixedCourtId)) {
      throw new ValidationError('La cancha fija de la división no está activa');
    }
  }
  const drafts = input.slots.map((slot, index) => {
    if (input.fixedCourtId && slot.canchaId && slot.canchaId !== input.fixedCourtId) {
      throw new ValidationError(`El slot #${index} debe usar la cancha fija de la división`);
    }
    if (!input.multiplesCanchas && slot.canchaId) {
      throw new ValidationError('Las ligas de cancha única deben enviar canchaId nulo');
    }
    if (input.multiplesCanchas && (!slot.canchaId || !activeById.has(slot.canchaId))) {
      throw new ValidationError(`El slot #${index} debe usar una cancha activa de esta liga`);
    }
    const interval = getAuthoritativeSlotInterval(slot, input.durationMinutes);
    return { id: `slot-${index}`, canchaId: input.multiplesCanchas ? slot.canchaId! : null, ...interval, slot };
  });

  if (drafts.length === 0) return;
  const latestDraftEnd = new Date(Math.max(...drafts.map((draft) => draft.end.getTime())));

  const occupancies = await client.partido.findMany({
    where: {
      // A match starting after every draft ends cannot overlap, regardless of its duration.
      fecha: { not: null, lt: latestDraftEnd },
      ...(input.excludedPartidoIds.length ? { id: { notIn: input.excludedPartidoIds } } : {}),
      OR: [
        { jornada: { division: { ligaId: input.ligaId } } },
        { rondaPlayoff: { division: { ligaId: input.ligaId } } },
      ],
    },
    select: {
      id: true,
      canchaId: true,
      fecha: true,
      jornada: { select: { division: { select: { duracionPartido: true } } } },
      rondaPlayoff: { select: { division: { select: { duracionPartido: true } } } },
    },
  });

  const persisted = occupancies.map((partido) => {
    const duration = partido.jornada?.division.duracionPartido ?? partido.rondaPlayoff?.division.duracionPartido;
    if (!duration || duration <= 0) {
      throw new ValidationError(`El partido ${partido.id} no tiene una duración de división válida; no se puede comprobar la capacidad de cancha`);
    }
    return {
      id: partido.id,
      canchaId: input.multiplesCanchas ? partido.canchaId : null,
      resolvedCourt: !input.multiplesCanchas || Boolean(partido.canchaId && activeById.has(partido.canchaId)),
      start: partido.fecha!,
      end: addMinutes(partido.fecha!, duration),
    };
  });

  for (let index = 0; index < drafts.length; index++) {
    const current = drafts[index];
    const draftConflict = drafts.slice(index + 1).find((other) =>
      other.canchaId === current.canchaId && isOverlapping(current.start, current.end, other.start, other.end));
    if (draftConflict) {
      const court = current.canchaId ? `La cancha "${activeById.get(current.canchaId)}"` : 'La cancha única de la liga';
      throw new ValidationError(`${court} ya tiene otro partido programado en ese horario (${current.slot.fecha} ${current.slot.horaInicio}-${current.slot.horaFin})`);
    }

    for (const occupancy of persisted) {
      if (!isOverlapping(current.start, current.end, occupancy.start, occupancy.end)) continue;
      if (!occupancy.resolvedCourt) {
        throw new ValidationError(`El partido programado ${occupancy.id} se solapa con el horario solicitado y no tiene una cancha activa válida; resuelve su cancha antes de generar la jornada`);
      }
      if (occupancy.canchaId !== current.canchaId) continue;
      const court = current.canchaId ? `La cancha "${activeById.get(current.canchaId)}"` : 'La cancha única de la liga';
      throw new ValidationError(`${court} ya tiene otro partido programado en ese horario (${current.slot.fecha} ${current.slot.horaInicio}-${current.slot.horaFin})`);
    }
  }
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

  async delete(id: string, actor: AuthenticatedUser): Promise<void> {
    const preflight = await jornadaRepository.findDeleteContext(id, actor);
    if (!preflight) throw new NotFoundError('Jornada');
    assertOwnerOrAdmin(actor, preflight.ligaUserId, 'Jornada');

    for (let attempt = 0; ; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          await acquireLeagueScheduleLock(tx, preflight.ligaId);
          const context = await jornadaRepository.findDeleteContext(id, actor, tx);
          if (!context) throw new NotFoundError('Jornada');
          assertOwnerOrAdmin(actor, context.ligaUserId, 'Jornada');
          if (context.ligaId !== preflight.ligaId) {
            throw new ConflictError('La jornada cambió durante la eliminación; vuelve a intentarlo');
          }
          if (context.latestJornadaId !== id) {
            throw new ValidationError('Solo se puede eliminar la última jornada generada');
          }
          const { divisionId, hasFinalizados, playoffPartidos } = context;
          const partidosByRonda = new Map<string, typeof playoffPartidos>();
          for (const partido of playoffPartidos) {
            const rondaId = partido.rondaPlayoffId;
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

            const nextKeys = [...new Set(partidos.map((p) => Math.ceil(p.llave / 2)))];
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
            await tx.anotacionPartido.deleteMany({ where: { partidoId: { in: playoffIds } } });
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
                version: { increment: 1 },
              },
            });
          }

          await tx.jornada.delete({ where: { id } });
          if (hasFinalizados) {
            await tablaPosicionService.recalcular(divisionId, tx);
          }
        }, { isolationLevel: 'Serializable' });
        return;
      } catch (error: any) {
        if (error?.code !== 'P2034' || attempt >= 2) throw error;
      }
    }
  },

  async generateNext(divisionId: string, actor: AuthenticatedUser, slots?: SlotInput[], equipoIds?: string[], descansoEquipoId?: string, generationKey = 'internal-generation', generationAttempt = 0): Promise<GeneratedJornada> {
    const startedAt = Date.now();
    const requestHash = generationRequestHash(slots, equipoIds, descansoEquipoId);
    const requestSlots = slots;
    const division = await prisma.division.findUnique({
      where: { id: divisionId },
      select: {
        diasPartido: true,
        duracionPartido: true,
        ligaId: true,
        canchaUnicaId: true,
        liga: { select: { userId: true, multiplesCanchas: true } },
      },
    });
    if (!division) throw new NotFoundError('División');
    assertOwnerOrAdmin(actor, division.liga.userId, 'División');
    const replay = await findGenerationReplay(prisma as unknown as GenerationLookupClient, divisionId, generationKey, requestHash);
    if (replay) return { ...replay, idempotencyReplayed: true };
    if (division.canchaUnicaId) {
      for (const [index, slot] of (slots ?? []).entries()) {
        if (slot.canchaId && slot.canchaId !== division.canchaUnicaId) {
          throw new ValidationError(`El slot #${index} debe usar la cancha fija de la división`);
        }
      }
      slots = slots?.map((slot) => ({ ...slot, canchaId: division.canchaUnicaId }));
    }

    // Check for playoff mode: when rondas exist, only amistoso and eliminatoria slots allowed
    const playoffRound = await prisma.rondaPlayoff.findFirst({ where: { divisionId }, select: { id: true } });
    const playoffMode = playoffRound !== null;
    if (playoffMode) {
      if (slots) {
        for (const s of slots) {
          if (s.tipo !== 'amistoso' && s.tipo !== 'eliminatoria') {
            throw new ValidationError('Solo se permiten partidos amistosos o de eliminatoria cuando hay eliminatorias');
          }
        }
      }
      if (descansoEquipoId) {
        throw new ValidationError('No se permite equipo que descansa cuando hay eliminatorias');
      }
    }

    const existing = await jornadaRepository.findGenerationHistory(divisionId);
    const preflightHistoryFingerprint = generationHistoryFingerprint(existing);
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
          where: { id: { in: eliminatoriaIds }, rondaPlayoff: { divisionId } },
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
          if (existing?.jornadaId) throw new ValidationError(`El partido de eliminatoria ${slot.partidoId} ya está programado`);

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

      // Keep fast validation for user feedback, but allow a concurrent identical request to replay.
      try {
        await validateLeagueCourtCapacity(prisma as unknown as CourtValidationClient, {
          ligaId: division.ligaId,
          multiplesCanchas: division.liga.multiplesCanchas,
          durationMinutes: division.duracionPartido,
          fixedCourtId: division.canchaUnicaId,
          slots: slots ?? [],
          excludedPartidoIds: pendingPlayoffUpdates.map((update) => update.id),
        });
      } catch (error) {
        const concurrentReplay = await findGenerationReplay(prisma as unknown as GenerationLookupClient, divisionId, generationKey, requestHash);
        if (concurrentReplay) return { ...concurrentReplay, idempotencyReplayed: true };
        throw error;
      }

      const regularTeamCount = teams.length - eliminatoriaTeamIds.size;
      const teamLimited = Math.max(0, Math.ceil(regularTeamCount / 2));
      let maxPartidos = Math.max(0, teamLimited - playoffCount);

      // Structure: each entry can be assigned teams or empty
      type PartidoPlan = { localId?: string; visitaId?: string; fecha?: Date; tipo?: 'regular' | 'complemento' | 'amistoso'; canchaId?: string | null };
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
      if (slots && slots.length > 0 && unassignedTeamList.length >= 2) {
        throw new ValidationError('No hay suficientes slots físicos para programar todos los partidos de la jornada');
      }
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
        if (p.tipo) continue
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
        if (p.tipo !== 'amistoso' && p.tipo !== 'complemento' && seenPairs.has(key)) {
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

      let jornada: JornadaEntity | undefined;
      let idempotencyReplayed = false;
      for (let attempt = 0; ; attempt += 1) {
        try {
          jornada = await prisma.$transaction(async (tx) => {
          await acquireLeagueScheduleLock(tx, division.ligaId);
          const replay = await findGenerationReplay(tx as unknown as GenerationLookupClient, divisionId, generationKey, requestHash);
          if (replay) {
            idempotencyReplayed = true;
            return replay;
          }
          const lockedDivision = await tx.division.findUnique({
            where: { id: divisionId },
            select: {
              ligaId: true,
              duracionPartido: true,
              canchaUnicaId: true,
              liga: { select: { multiplesCanchas: true } },
            },
          });
          if (!lockedDivision || lockedDivision.ligaId !== division.ligaId) {
            throw new ValidationError('La división cambió mientras se generaba la jornada; vuelve a intentarlo');
          }
          const lockedHistory = await jornadaRepository.findGenerationHistory(divisionId, tx);
          if (generationHistoryFingerprint(lockedHistory) !== preflightHistoryFingerprint) {
            throw new StaleGenerationPlanError();
          }
          await validateLeagueCourtCapacity(tx as unknown as CourtValidationClient, {
            ligaId: lockedDivision.ligaId,
            multiplesCanchas: lockedDivision.liga.multiplesCanchas,
            durationMinutes: lockedDivision.duracionPartido,
            fixedCourtId: lockedDivision.canchaUnicaId,
            slots: slots ?? [],
            excludedPartidoIds: pendingPlayoffUpdates.map((update) => update.id),
          });
          const created = await tx.jornada.create({
          data: { numero: nextNumero, divisionId, fechaInicio, fechaFin, generationKey, generationRequestHash: requestHash },
        });
        for (const update of pendingPlayoffUpdates) {
          const result = await tx.partido.updateMany({
            where: { id: update.id, jornadaId: null },
            data: { ...update.data, jornadaId: created.id },
          });
          if (result.count !== 1) throw new StaleGenerationPlanError();
        }
          if (partidoData.length > 0) {
          await tx.partido.createMany({
            data: partidoData.map((partido) => ({ ...partido, jornadaId: created.id })) as any,
           });
          }
          await tx.notificationOutbox.createMany({
            data: [
              {
                eventKey: `jornada-generated:${created.id}:registered`,
                jornadaId: created.id,
                divisionId,
                audience: 'REGISTERED',
                providerIdempotencyKey: randomUUID(),
              },
              {
                eventKey: `jornada-generated:${created.id}:followers`,
                jornadaId: created.id,
                divisionId,
                audience: 'FOLLOWERS',
                providerIdempotencyKey: randomUUID(),
              },
            ],
            skipDuplicates: true,
          });
          return created;
          }, { isolationLevel: 'Serializable' });
          break;
        } catch (error: any) {
          if (error instanceof StaleGenerationPlanError) {
            if (generationAttempt < 2) {
              return jornadaService.generateNext(divisionId, actor, requestSlots, equipoIds, descansoEquipoId, generationKey, generationAttempt + 1);
            }
            throw new ConflictError('La programación cambió mientras se generaba la jornada; vuelve a intentarlo');
          }
          if (error?.code === 'P2034' && attempt < 2) continue;
          if (error?.code === 'P2002') throw new ConflictError('La jornada ya fue generada');
          if (isCourtExclusionError(error)) {
            throw new ValidationError('La cancha ya fue ocupada por otro partido; actualiza los horarios e inténtalo de nuevo');
          }
          throw error;
        }
      }

    const committedJornada = jornada!;
    const updatedPlayoffIds = new Set(pendingPlayoffUpdates.map((update) => update.id));
    const createdPartidoCount = partidoData.length;

    logger.info({
      divisionId,
      jornadaId: committedJornada.id,
      counts: {
        created: createdPartidoCount,
        playoffUpdated: updatedPlayoffIds.size,
        total: createdPartidoCount + updatedPlayoffIds.size,
      },
      durationMs: Date.now() - startedAt,
    }, 'Jornada generation completed');

    const { generationKey: _generationKey, generationRequestHash: _generationRequestHash, ...publicJornada } = committedJornada as JornadaEntity & { generationKey?: string; generationRequestHash?: string };
    return { ...publicJornada, idempotencyReplayed };
  },
};

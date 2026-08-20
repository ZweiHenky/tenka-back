import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../types/auth';
import { assertOwnerOrAdmin } from '../../utils/authorization';
import { acquireLeagueScheduleLock } from '../../utils/leagueScheduleLock';
import { parseConfiguredDays, resolveDivisionSchedule } from '../../utils/divisionSchedule';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { enqueueScheduleChange } from '../notification/scheduleChangeOutbox';
import { exposePartidoRead, PARTIDO_READ_INCLUDE } from './repository';
import type { CreateInJornadaInput } from './validator';
import { addCivilDays, civilToInstant, dateKeyInTimeZone, timeInTimeZone } from '../../utils/timeZone';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { parseConfiguredRanges } from '../../utils/timeRanges';

export { parseConfiguredRanges } from '../../utils/timeRanges';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface JornadaTeamOption {
  id: string;
  nombre: string;
  pendiente: boolean;
}

export interface JornadaSlotOption {
  id: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  canchaId: string | null;
  canchaNombre: string | null;
  equiposOcupados: string[];
  canchaDisponible: boolean;
}

export interface JornadaPartidoOptions {
  equipos: JornadaTeamOption[];
  pendientes: JornadaTeamOption[];
  recomendacion: 'REGULAR' | 'COMPLEMENTO' | 'MANUAL';
  localSugeridoId: string | null;
  visitanteSugeridoId: string | null;
  slots: JornadaSlotOption[];
}

// El parser de dias vive en utils/divisionSchedule (unico para todo el backend).
// Se re-exporta aqui porque este modulo era su hogar original.
export { parseConfiguredDays };

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function weekBounds(anchor: Date): { start: Date; end: Date } {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = start.getDay() === 0 ? -6 : 1 - start.getDay();
  start.setDate(start.getDate() + mondayOffset);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function configuredCandidates(
  now: Date,
  weekAnchor: Date,
  timeZone: string,
  days: ReadonlySet<number>,
  ranges: Array<{ start: number; end: number }>,
  durationMinutes: number,
  breakMinutes: number,
): Array<{ start: Date; end: Date; fecha: string; horaInicio: string; horaFin: string }> {
  const anchorKey = dateKeyInTimeZone(weekAnchor, timeZone);
  const [anchorYear, anchorMonth, anchorDay] = anchorKey.split('-').map(Number);
  const anchorCivil = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay));
  const mondayOffset = anchorCivil.getUTCDay() === 0 ? -6 : 1 - anchorCivil.getUTCDay();
  const mondayKey = addCivilDays(anchorKey, mondayOffset);
  const sundayKey = addCivilDays(mondayKey, 6);
  const weekEnd = civilToInstant(sundayKey, '23:59', timeZone);
  if (now > weekEnd) return [];
  const candidates: Array<{ start: Date; end: Date; fecha: string; horaInicio: string; horaFin: string }> = [];
  const step = durationMinutes + Math.max(0, breakMinutes);

  for (let offset = 0; offset <= 6; offset += 1) {
    const civilDate = addCivilDays(mondayKey, offset);
    const [year, month, day] = civilDate.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (!days.has(dayOfWeek)) continue;
    for (const range of ranges) {
      for (let minute = range.start; minute + durationMinutes <= range.end; minute += step) {
        const pad = (value: number) => String(value).padStart(2, '0');
        const civilStart = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
        const start = civilToInstant(civilDate, civilStart, timeZone);
        if (start <= now || start > weekEnd) continue;
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        if (end <= weekEnd) {
          candidates.push({
            start,
            end,
            fecha: civilDate,
            horaInicio: civilStart,
            horaFin: timeInTimeZone(end, timeZone),
          });
        }
      }
    }
  }
  return candidates;
}

export function coveredTeamIds(partidos: Array<{ tipoPartido: string; equipoLocalId: string | null; equipoVisitanteId: string | null }>): Set<string> {
  const covered = new Set<string>();
  for (const partido of partidos) {
    if (partido.tipoPartido === 'REGULAR') {
      if (partido.equipoLocalId) covered.add(partido.equipoLocalId);
      if (partido.equipoVisitanteId) covered.add(partido.equipoVisitanteId);
    } else if (partido.tipoPartido === 'COMPLEMENTO' && partido.equipoLocalId) {
      covered.add(partido.equipoLocalId);
    }
  }
  return covered;
}

const overlaps = (start: Date, end: Date, otherStart: Date, otherEnd: Date) => start < otherEnd && otherStart < end;

async function buildOptions(jornadaId: string, actor: AuthenticatedUser, client: DbClient, now = new Date()): Promise<JornadaPartidoOptions> {
  const jornada = await client.jornada.findUnique({
    where: { id: jornadaId },
    select: {
      id: true,
      fechaInicio: true,
      fechaFin: true,
      division: {
        select: {
          id: true,
          ligaId: true,
          diasPartido: true,
          horarioPartido: true,
          duracionPartido: true,
          descanso: true,
          canchaUnicaId: true,
          canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } },
          estadoLiga: { select: { nombre: true } },
          liga: { select: { userId: true, multiplesCanchas: true, timeZone: true } },
          equipos: { select: { equipo: { select: { id: true, nombre: true } } } },
        },
      },
      partidos: { select: { tipoPartido: true, equipoLocalId: true, equipoVisitanteId: true } },
    },
  });
  if (!jornada) throw new NotFoundError('Jornada');
  assertOwnerOrAdmin(actor, jornada.division.liga.userId, 'Jornada');
  if (normalize(jornada.division.estadoLiga.nombre) !== 'en curso') {
    throw new ValidationError('Solo se pueden agregar partidos a una división en curso');
  }
  const { diasPartido, horarioPartido, duracionPartido } = jornada.division;
  // The scalars may be empty when the schedule lives entirely in canchaHorarios; whether the
  // division actually has a usable window is decided per court by resolveDivisionSchedule below.
  if (!jornada.fechaInicio || !jornada.fechaFin || !duracionPartido || duracionPartido <= 0) {
    throw new ValidationError('La jornada o la división no tienen una configuración de fechas y horarios válida');
  }

  const teams = jornada.division.equipos.map(({ equipo }) => equipo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const covered = coveredTeamIds(jornada.partidos);
  const pendingIds = new Set(teams.filter((team) => !covered.has(team.id)).map((team) => team.id));
  const equipos = teams.map((team) => ({ ...team, pendiente: pendingIds.has(team.id) }));
  const pendientes = equipos.filter((team) => team.pendiente);
  const recomendacion = pendientes.length === 2 ? 'REGULAR' : pendientes.length === 1 ? 'COMPLEMENTO' : 'MANUAL';

  // Courts first: each one carries its own days/ranges, so candidates depend on them.
  const courts = await client.ligaCancha.findMany({
    where: { ligaId: jornada.division.ligaId, activa: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
  const activeCourtIds = new Set(courts.map((court) => court.id));
  if (jornada.division.liga.multiplesCanchas && jornada.division.canchaUnicaId && !activeCourtIds.has(jornada.division.canchaUnicaId)) {
    throw new ValidationError('La cancha fija de la división no está activa');
  }

  const scheduleByCourt = resolveDivisionSchedule({
    multiplesCanchas: jornada.division.liga.multiplesCanchas,
    diasPartido,
    horarioPartido,
    canchaUnicaId: jornada.division.canchaUnicaId,
    canchaHorarios: jornada.division.canchaHorarios,
  }, activeCourtIds);

  const candidateCourts: Array<{ id: string | null; nombre: string | null }> = jornada.division.liga.multiplesCanchas
    ? courts.filter((court) => !jornada.division.canchaUnicaId || court.id === jornada.division.canchaUnicaId)
    : [{ id: null, nombre: null }];
  // A court is usable only if it resolves to both days and ranges; otherwise the division has
  // nothing configured there. Zero usable courts is a configuration error, not an empty result.
  const courtOptions = candidateCourts.filter((court) => {
    const courtSchedule = scheduleByCourt.get(court.id);
    return !!courtSchedule && courtSchedule.days.size > 0 && courtSchedule.ranges.length > 0;
  });
  if (!courtOptions.length) throw new ValidationError('La división no tiene canchas con horario configurado');

  // One candidate pass per court, using that court's own days and ranges.
  const pairs = courtOptions.flatMap((court) => {
    const courtSchedule = scheduleByCourt.get(court.id)!;
    return configuredCandidates(
      now, jornada.fechaInicio!, jornada.division.liga.timeZone,
      courtSchedule.days, courtSchedule.ranges, duracionPartido, jornada.division.descanso ?? 0,
    ).map((candidate) => ({ court, candidate }));
  });

  if (!pairs.length) return { equipos, pendientes, recomendacion, localSugeridoId: pendientes[0]?.id ?? null, visitanteSugeridoId: pendientes[1]?.id ?? null, slots: [] };
  const maxEnd = new Date(Math.max(...pairs.map(({ candidate }) => candidate.end.getTime())));
  const minStart = new Date(Math.min(...pairs.map(({ candidate }) => candidate.start.getTime())));
  const occupancy = await client.partido.findMany({
    where: {
      fecha: { lt: maxEnd },
      fechaFin: { gt: minStart },
      OR: [
        { jornada: { division: { ligaId: jornada.division.ligaId } } },
        { rondaPlayoff: { division: { ligaId: jornada.division.ligaId } } },
      ],
    },
    select: { fecha: true, fechaFin: true, canchaId: true, equipoLocalId: true, equipoVisitanteId: true },
  });

  const slots: JornadaSlotOption[] = pairs.map(({ court, candidate }) => {
    const concurrent = occupancy.filter((item) => item.fecha && item.fechaFin && overlaps(candidate.start, candidate.end, item.fecha, item.fechaFin));
    const busyTeams = [...new Set(concurrent.flatMap((item) => [item.equipoLocalId, item.equipoVisitanteId]).filter((id): id is string => Boolean(id)))];
    const courtBusy = concurrent.some((item) => jornada.division.liga.multiplesCanchas ? item.canchaId === court.id : true);
    return {
      id: `${candidate.fecha}|${candidate.horaInicio}|${court.id ?? 'single'}`,
      fecha: candidate.fecha,
      horaInicio: candidate.horaInicio,
      horaFin: candidate.horaFin,
      canchaId: court.id,
      canchaNombre: court.nombre,
      equiposOcupados: busyTeams,
      canchaDisponible: !courtBusy,
    };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha)
    || a.horaInicio.localeCompare(b.horaInicio)
    || (a.canchaNombre ?? '').localeCompare(b.canchaNombre ?? ''));

  return { equipos, pendientes, recomendacion, localSugeridoId: pendientes[0]?.id ?? null, visitanteSugeridoId: pendientes[1]?.id ?? null, slots };
}

function requestHash(data: CreateInJornadaInput): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const jornadaPartidoCreationService = {
  getOptions(jornadaId: string, actor: AuthenticatedUser) {
    return buildOptions(jornadaId, actor, prisma);
  },

  async create(jornadaId: string, data: CreateInJornadaInput, idempotencyKey: string, actor: AuthenticatedUser) {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ValidationError('Se requiere una clave de idempotencia válida');
    if (data.equipoLocalId === data.equipoVisitanteId) throw new ValidationError('Los equipos deben ser diferentes');
    const hash = requestHash(data);
    const replay = await prisma.partido.findUnique({ where: { manualCreationKey: idempotencyKey }, include: PARTIDO_READ_INCLUDE });
    if (replay) {
      if (replay.manualCreationHash !== hash || replay.jornadaId !== jornadaId) throw new ConflictError('La clave de idempotencia ya fue utilizada con otros datos');
      return exposePartidoRead(replay);
    }

    try {
      const partido = await prisma.$transaction(async (tx) => {
        const jornada = await tx.jornada.findUnique({ where: { id: jornadaId }, select: { division: { select: { ligaId: true, id: true, liga: { select: { timeZone: true } } } } } });
        if (!jornada) throw new NotFoundError('Jornada');
        await acquireLeagueScheduleLock(tx, jornada.division.ligaId);

        const lockedReplay = await tx.partido.findUnique({ where: { manualCreationKey: idempotencyKey }, include: PARTIDO_READ_INCLUDE });
        if (lockedReplay) {
          if (lockedReplay.manualCreationHash !== hash || lockedReplay.jornadaId !== jornadaId) throw new ConflictError('La clave de idempotencia ya fue utilizada con otros datos');
          return exposePartidoRead(lockedReplay);
        }
        const options = await buildOptions(jornadaId, actor, tx);
        const teamIds = new Set(options.equipos.map((team) => team.id));
        if (!teamIds.has(data.equipoLocalId) || !teamIds.has(data.equipoVisitanteId)) throw new ValidationError('Ambos equipos deben pertenecer a la división');
        if (data.tipoPartido === 'REGULAR') {
          if (options.pendientes.length !== 2) throw new ValidationError('Solo se puede agregar un partido regular cuando hay dos equipos pendientes');
        } else if (options.pendientes.length !== 1 || options.pendientes[0].id !== data.equipoLocalId) {
          throw new ValidationError('El complemento debe tener como local al único equipo pendiente');
        }
        const slot = options.slots.find((option) => option.fecha === data.fecha
          && option.horaInicio === data.horaInicio
          && option.horaFin === data.horaFin
          && option.canchaId === (data.canchaId ?? null)
          && option.canchaDisponible);
        if (!slot) throw new ConflictError('El horario seleccionado ya no está disponible');
        if (slot.equiposOcupados.includes(data.equipoLocalId) || slot.equiposOcupados.includes(data.equipoVisitanteId)) {
          throw new ConflictError('Uno de los equipos ya tiene otro partido en ese horario');
        }
        const partido = await tx.partido.create({
          data: {
            jornadaId,
            equipoLocalId: data.equipoLocalId,
            equipoVisitanteId: data.equipoVisitanteId,
            tipoPartido: data.tipoPartido,
            exhibicionVisitante: data.tipoPartido === 'COMPLEMENTO',
            fecha: civilToInstant(slot.fecha, slot.horaInicio, jornada.division.liga.timeZone),
            fechaFin: civilToInstant(slot.fecha, slot.horaFin, jornada.division.liga.timeZone),
            canchaId: slot.canchaId,
            estado: 'PROGRAMADO',
            manualCreationKey: idempotencyKey,
            manualCreationHash: hash,
          },
          include: PARTIDO_READ_INCLUDE,
        });
        await enqueueScheduleChange(tx, {
          divisionId: jornada.division.id,
          ligaId: jornada.division.ligaId,
          changes: { teamIds: [data.equipoLocalId, data.equipoVisitanteId], jornadaIds: [jornadaId], partidoIds: [partido.id] },
        });
        return exposePartidoRead(partido);
      }, { isolationLevel: 'Serializable' });
      signalBackgroundJob('notification-outbox');
      return partido;
    } catch (error: any) {
      if (error?.code === 'P2002' || error?.code === '23P01' || /partidos_cancha_no_overlap/.test(error?.message ?? '')) {
        throw new ConflictError('El horario seleccionado ya no está disponible');
      }
      throw error;
    }
  },
};

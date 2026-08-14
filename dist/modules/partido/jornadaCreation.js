"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jornadaPartidoCreationService = void 0;
exports.parseConfiguredDays = parseConfiguredDays;
exports.parseConfiguredRanges = parseConfiguredRanges;
exports.weekBounds = weekBounds;
exports.configuredCandidates = configuredCandidates;
exports.coveredTeamIds = coveredTeamIds;
const node_crypto_1 = require("node:crypto");
const database_1 = require("../../config/database");
const authorization_1 = require("../../utils/authorization");
const leagueScheduleLock_1 = require("../../utils/leagueScheduleLock");
const errors_1 = require("../../utils/errors");
const scheduleChangeOutbox_1 = require("../notification/scheduleChangeOutbox");
const repository_1 = require("./repository");
const timeZone_1 = require("../../utils/timeZone");
const DAY_MAP = {
    dom: 0, domingo: 0, domingos: 0, do: 0, d: 0,
    lun: 1, lunes: 1, lu: 1, l: 1,
    mar: 2, martes: 2, ma: 2, m: 2,
    mie: 3, miercoles: 3, mi: 3,
    jue: 4, jueves: 4, ju: 4, j: 4,
    vie: 5, viernes: 5, vi: 5, v: 5,
    sab: 6, sabado: 6, sabados: 6, sa: 6, s: 6,
};
function normalize(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function parseConfiguredDays(value) {
    const days = new Set();
    for (const raw of normalize(value).replace(/\s+y\s+/g, ',').replace(/\//g, ',').split(/[,;]+/)) {
        const part = raw.trim();
        const range = part.match(/^(.+?)\s+(?:a|al)\s+(.+)$/) ?? part.match(/^(.+?)\s*-\s*(.+)$/);
        if (range) {
            const from = DAY_MAP[range[1].trim()];
            const to = DAY_MAP[range[2].trim()];
            if (from !== undefined && to !== undefined) {
                let day = from;
                while (true) {
                    days.add(day);
                    if (day === to)
                        break;
                    day = (day + 1) % 7;
                }
            }
            continue;
        }
        const day = DAY_MAP[part] ?? DAY_MAP[part.slice(0, 3)];
        if (day !== undefined)
            days.add(day);
    }
    return days;
}
function parseConfiguredRanges(value) {
    return value.split('/').flatMap((raw) => {
        const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!match)
            return [];
        const start = Number(match[1]) * 60 + Number(match[2]);
        const end = Number(match[3]) * 60 + Number(match[4]);
        return start < end ? [{ start, end }] : [];
    });
}
function weekBounds(anchor) {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const mondayOffset = start.getDay() === 0 ? -6 : 1 - start.getDay();
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}
function configuredCandidates(now, weekAnchor, timeZone, days, ranges, durationMinutes, breakMinutes) {
    const anchorKey = (0, timeZone_1.dateKeyInTimeZone)(weekAnchor, timeZone);
    const [anchorYear, anchorMonth, anchorDay] = anchorKey.split('-').map(Number);
    const anchorCivil = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay));
    const mondayOffset = anchorCivil.getUTCDay() === 0 ? -6 : 1 - anchorCivil.getUTCDay();
    const mondayKey = (0, timeZone_1.addCivilDays)(anchorKey, mondayOffset);
    const sundayKey = (0, timeZone_1.addCivilDays)(mondayKey, 6);
    const weekEnd = (0, timeZone_1.civilToInstant)(sundayKey, '23:59', timeZone);
    if (now > weekEnd)
        return [];
    const candidates = [];
    const step = durationMinutes + Math.max(0, breakMinutes);
    for (let offset = 0; offset <= 6; offset += 1) {
        const civilDate = (0, timeZone_1.addCivilDays)(mondayKey, offset);
        const [year, month, day] = civilDate.split('-').map(Number);
        const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        if (!days.has(dayOfWeek))
            continue;
        for (const range of ranges) {
            for (let minute = range.start; minute + durationMinutes <= range.end; minute += step) {
                const pad = (value) => String(value).padStart(2, '0');
                const civilStart = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
                const start = (0, timeZone_1.civilToInstant)(civilDate, civilStart, timeZone);
                if (start <= now || start > weekEnd)
                    continue;
                const end = new Date(start.getTime() + durationMinutes * 60000);
                if (end <= weekEnd) {
                    candidates.push({
                        start,
                        end,
                        fecha: civilDate,
                        horaInicio: civilStart,
                        horaFin: (0, timeZone_1.timeInTimeZone)(end, timeZone),
                    });
                }
            }
        }
    }
    return candidates;
}
function coveredTeamIds(partidos) {
    const covered = new Set();
    for (const partido of partidos) {
        if (partido.tipoPartido === 'REGULAR') {
            if (partido.equipoLocalId)
                covered.add(partido.equipoLocalId);
            if (partido.equipoVisitanteId)
                covered.add(partido.equipoVisitanteId);
        }
        else if (partido.tipoPartido === 'COMPLEMENTO' && partido.equipoLocalId) {
            covered.add(partido.equipoLocalId);
        }
    }
    return covered;
}
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && otherStart < end;
async function buildOptions(jornadaId, actor, client, now = new Date()) {
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
                    estadoLiga: { select: { nombre: true } },
                    liga: { select: { userId: true, multiplesCanchas: true, timeZone: true } },
                    equipos: { select: { equipo: { select: { id: true, nombre: true } } } },
                },
            },
            partidos: { select: { tipoPartido: true, equipoLocalId: true, equipoVisitanteId: true } },
        },
    });
    if (!jornada)
        throw new errors_1.NotFoundError('Jornada');
    (0, authorization_1.assertOwnerOrAdmin)(actor, jornada.division.liga.userId, 'Jornada');
    if (normalize(jornada.division.estadoLiga.nombre) !== 'en curso') {
        throw new errors_1.ValidationError('Solo se pueden agregar partidos a una división en curso');
    }
    const { diasPartido, horarioPartido, duracionPartido } = jornada.division;
    if (!jornada.fechaInicio || !jornada.fechaFin || !diasPartido || !horarioPartido || !duracionPartido || duracionPartido <= 0) {
        throw new errors_1.ValidationError('La jornada o la división no tienen una configuración de fechas y horarios válida');
    }
    const teams = jornada.division.equipos.map(({ equipo }) => equipo).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const covered = coveredTeamIds(jornada.partidos);
    const pendingIds = new Set(teams.filter((team) => !covered.has(team.id)).map((team) => team.id));
    const equipos = teams.map((team) => ({ ...team, pendiente: pendingIds.has(team.id) }));
    const pendientes = equipos.filter((team) => team.pendiente);
    const recomendacion = pendientes.length === 2 ? 'REGULAR' : pendientes.length === 1 ? 'COMPLEMENTO' : 'MANUAL';
    const days = parseConfiguredDays(diasPartido);
    const ranges = parseConfiguredRanges(horarioPartido);
    if (!days.size || !ranges.length)
        throw new errors_1.ValidationError('Los días u horarios configurados en la división no son válidos');
    const candidates = configuredCandidates(now, jornada.fechaInicio, jornada.division.liga.timeZone, days, ranges, duracionPartido, jornada.division.descanso ?? 0);
    if (!candidates.length)
        return { equipos, pendientes, recomendacion, localSugeridoId: pendientes[0]?.id ?? null, visitanteSugeridoId: pendientes[1]?.id ?? null, slots: [] };
    const maxEnd = new Date(Math.max(...candidates.map((slot) => slot.end.getTime())));
    const minStart = new Date(Math.min(...candidates.map((slot) => slot.start.getTime())));
    const [courts, occupancy] = await Promise.all([
        client.ligaCancha.findMany({
            where: { ligaId: jornada.division.ligaId, activa: true },
            select: { id: true, nombre: true },
            orderBy: { nombre: 'asc' },
        }),
        client.partido.findMany({
            where: {
                fecha: { lt: maxEnd },
                fechaFin: { gt: minStart },
                OR: [
                    { jornada: { division: { ligaId: jornada.division.ligaId } } },
                    { rondaPlayoff: { division: { ligaId: jornada.division.ligaId } } },
                ],
            },
            select: { fecha: true, fechaFin: true, canchaId: true, equipoLocalId: true, equipoVisitanteId: true },
        }),
    ]);
    const activeCourtIds = new Set(courts.map((court) => court.id));
    if (jornada.division.liga.multiplesCanchas && jornada.division.canchaUnicaId && !activeCourtIds.has(jornada.division.canchaUnicaId)) {
        throw new errors_1.ValidationError('La cancha fija de la división no está activa');
    }
    const courtOptions = jornada.division.liga.multiplesCanchas
        ? courts.filter((court) => !jornada.division.canchaUnicaId || court.id === jornada.division.canchaUnicaId)
        : [{ id: null, nombre: null }];
    const slots = [];
    for (const candidate of candidates) {
        const concurrent = occupancy.filter((item) => item.fecha && item.fechaFin && overlaps(candidate.start, candidate.end, item.fecha, item.fechaFin));
        const busyTeams = [...new Set(concurrent.flatMap((item) => [item.equipoLocalId, item.equipoVisitanteId]).filter((id) => Boolean(id)))];
        for (const court of courtOptions) {
            const courtBusy = concurrent.some((item) => jornada.division.liga.multiplesCanchas ? item.canchaId === court.id : true);
            slots.push({
                id: `${candidate.fecha}|${candidate.horaInicio}|${court.id ?? 'single'}`,
                fecha: candidate.fecha,
                horaInicio: candidate.horaInicio,
                horaFin: candidate.horaFin,
                canchaId: court.id,
                canchaNombre: court.nombre,
                equiposOcupados: busyTeams,
                canchaDisponible: !courtBusy,
            });
        }
    }
    return { equipos, pendientes, recomendacion, localSugeridoId: pendientes[0]?.id ?? null, visitanteSugeridoId: pendientes[1]?.id ?? null, slots };
}
function requestHash(data) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(data)).digest('hex');
}
exports.jornadaPartidoCreationService = {
    getOptions(jornadaId, actor) {
        return buildOptions(jornadaId, actor, database_1.prisma);
    },
    async create(jornadaId, data, idempotencyKey, actor) {
        if (!idempotencyKey || idempotencyKey.length > 200)
            throw new errors_1.ValidationError('Se requiere una clave de idempotencia válida');
        if (data.equipoLocalId === data.equipoVisitanteId)
            throw new errors_1.ValidationError('Los equipos deben ser diferentes');
        const hash = requestHash(data);
        const replay = await database_1.prisma.partido.findUnique({ where: { manualCreationKey: idempotencyKey }, include: repository_1.PARTIDO_READ_INCLUDE });
        if (replay) {
            if (replay.manualCreationHash !== hash || replay.jornadaId !== jornadaId)
                throw new errors_1.ConflictError('La clave de idempotencia ya fue utilizada con otros datos');
            return (0, repository_1.exposePartidoRead)(replay);
        }
        try {
            return await database_1.prisma.$transaction(async (tx) => {
                const jornada = await tx.jornada.findUnique({ where: { id: jornadaId }, select: { division: { select: { ligaId: true, id: true, liga: { select: { timeZone: true } } } } } });
                if (!jornada)
                    throw new errors_1.NotFoundError('Jornada');
                await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, jornada.division.ligaId);
                const lockedReplay = await tx.partido.findUnique({ where: { manualCreationKey: idempotencyKey }, include: repository_1.PARTIDO_READ_INCLUDE });
                if (lockedReplay) {
                    if (lockedReplay.manualCreationHash !== hash || lockedReplay.jornadaId !== jornadaId)
                        throw new errors_1.ConflictError('La clave de idempotencia ya fue utilizada con otros datos');
                    return (0, repository_1.exposePartidoRead)(lockedReplay);
                }
                const options = await buildOptions(jornadaId, actor, tx);
                const teamIds = new Set(options.equipos.map((team) => team.id));
                if (!teamIds.has(data.equipoLocalId) || !teamIds.has(data.equipoVisitanteId))
                    throw new errors_1.ValidationError('Ambos equipos deben pertenecer a la división');
                if (data.tipoPartido === 'REGULAR') {
                    if (options.pendientes.length !== 2)
                        throw new errors_1.ValidationError('Solo se puede agregar un partido regular cuando hay dos equipos pendientes');
                }
                else if (options.pendientes.length !== 1 || options.pendientes[0].id !== data.equipoLocalId) {
                    throw new errors_1.ValidationError('El complemento debe tener como local al único equipo pendiente');
                }
                const slot = options.slots.find((option) => option.fecha === data.fecha
                    && option.horaInicio === data.horaInicio
                    && option.horaFin === data.horaFin
                    && option.canchaId === (data.canchaId ?? null)
                    && option.canchaDisponible);
                if (!slot)
                    throw new errors_1.ConflictError('El horario seleccionado ya no está disponible');
                if (slot.equiposOcupados.includes(data.equipoLocalId) || slot.equiposOcupados.includes(data.equipoVisitanteId)) {
                    throw new errors_1.ConflictError('Uno de los equipos ya tiene otro partido en ese horario');
                }
                const partido = await tx.partido.create({
                    data: {
                        jornadaId,
                        equipoLocalId: data.equipoLocalId,
                        equipoVisitanteId: data.equipoVisitanteId,
                        tipoPartido: data.tipoPartido,
                        exhibicionVisitante: data.tipoPartido === 'COMPLEMENTO',
                        fecha: (0, timeZone_1.civilToInstant)(slot.fecha, slot.horaInicio, jornada.division.liga.timeZone),
                        fechaFin: (0, timeZone_1.civilToInstant)(slot.fecha, slot.horaFin, jornada.division.liga.timeZone),
                        canchaId: slot.canchaId,
                        estado: 'PROGRAMADO',
                        manualCreationKey: idempotencyKey,
                        manualCreationHash: hash,
                    },
                    include: repository_1.PARTIDO_READ_INCLUDE,
                });
                await (0, scheduleChangeOutbox_1.enqueueScheduleChange)(tx, {
                    divisionId: jornada.division.id,
                    ligaId: jornada.division.ligaId,
                    changes: { teamIds: [data.equipoLocalId, data.equipoVisitanteId], jornadaIds: [jornadaId], partidoIds: [partido.id] },
                });
                return (0, repository_1.exposePartidoRead)(partido);
            }, { isolationLevel: 'Serializable' });
        }
        catch (error) {
            if (error?.code === 'P2002' || error?.code === '23P01' || /partidos_cancha_no_overlap/.test(error?.message ?? '')) {
                throw new errors_1.ConflictError('El horario seleccionado ya no está disponible');
            }
            throw error;
        }
    },
};
//# sourceMappingURL=jornadaCreation.js.map
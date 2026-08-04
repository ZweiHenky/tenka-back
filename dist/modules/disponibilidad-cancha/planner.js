"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.halfOpenOverlaps = halfOpenOverlaps;
exports.planCourtAssignments = planCourtAssignments;
function halfOpenOverlaps(left, right) {
    return left.fecha.getTime() < right.fechaFin.getTime()
        && left.fechaFin.getTime() > right.fecha.getTime();
}
function planCourtAssignments(input) {
    const courtIds = input.mode === 'SINGLE'
        ? ['__VIRTUAL__']
        : [...new Set(input.canchas.map(({ id }) => id))].sort();
    const active = new Set(courtIds);
    const schedule = new Map(courtIds.map((id) => [id, []]));
    const load = new Map(courtIds.map((id) => [id, 0]));
    const asignados = [];
    const conflictos = [];
    const sinAsignar = [];
    const automaticos = [];
    const ordered = [...input.borradores].sort(compareIntervals);
    for (const occupancy of input.ocupaciones) {
        const courtId = input.mode === 'SINGLE' ? '__VIRTUAL__' : occupancy.canchaId;
        if (courtId && active.has(courtId)) {
            schedule.get(courtId).push(occupancy);
            load.set(courtId, load.get(courtId) + 1);
        }
    }
    for (const draft of ordered) {
        const manualCourt = input.mode === 'MULTIPLE' ? draft.canchaId : null;
        if (!manualCourt || !active.has(manualCourt)) {
            automaticos.push(draft);
            continue;
        }
        const overlaps = schedule.get(manualCourt).filter((item) => halfOpenOverlaps(draft, item));
        if (overlaps.length)
            conflictos.push({
                partidoId: draft.id,
                canchaId: manualCourt,
                conPartidos: overlaps.map(({ id }) => id).sort(),
                reason: 'OVERLAP',
            });
        schedule.get(manualCourt).push(draft);
        load.set(manualCourt, load.get(manualCourt) + 1);
        asignados.push({ ...draft, canchaId: manualCourt });
    }
    for (const draft of automaticos) {
        const available = courtIds
            .filter((courtId) => !schedule.get(courtId).some((item) => halfOpenOverlaps(draft, item)))
            .sort((left, right) => load.get(left) - load.get(right) || left.localeCompare(right));
        const courtId = available[0];
        if (!courtId) {
            const blockers = courtIds.flatMap((id) => schedule.get(id).filter((item) => halfOpenOverlaps(draft, item)));
            sinAsignar.push(draft);
            conflictos.push({
                partidoId: draft.id,
                canchaId: null,
                conPartidos: [...new Set(blockers.map(({ id }) => id))].sort(),
                reason: 'NO_CAPACITY',
            });
            continue;
        }
        schedule.get(courtId).push(draft);
        load.set(courtId, load.get(courtId) + 1);
        asignados.push({ ...draft, canchaId: input.mode === 'SINGLE' ? null : courtId });
    }
    asignados.sort(compareIntervals);
    return { asignados, conflictos, sinAsignar };
}
function compareIntervals(left, right) {
    return left.fecha.getTime() - right.fecha.getTime()
        || left.fechaFin.getTime() - right.fechaFin.getTime()
        || left.id.localeCompare(right.id);
}
//# sourceMappingURL=planner.js.map
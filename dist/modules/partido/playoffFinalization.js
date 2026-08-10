"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePlayoffFinalizationSchedule = validatePlayoffFinalizationSchedule;
function validatePlayoffFinalizationSchedule(schedule) {
    if (!schedule.fecha || !schedule.fechaFin) {
        return 'Para asignar resultados, primero genera la jornada.';
    }
    const fecha = schedule.fecha instanceof Date ? schedule.fecha : new Date(schedule.fecha);
    const fechaFin = schedule.fechaFin instanceof Date ? schedule.fechaFin : new Date(schedule.fechaFin);
    if (!Number.isFinite(fecha.getTime()) || !Number.isFinite(fechaFin.getTime()) || fechaFin <= fecha) {
        return 'Para asignar resultados, primero genera la jornada.';
    }
    if (schedule.multiplesCanchas && !schedule.canchaId) {
        return 'No se puede finalizar un partido de eliminatoria sin cancha en una liga con múltiples canchas';
    }
    return null;
}
//# sourceMappingURL=playoffFinalization.js.map
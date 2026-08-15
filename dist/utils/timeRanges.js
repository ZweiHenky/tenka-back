"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfiguredRanges = parseConfiguredRanges;
exports.isTimeSlotWithinConfiguredRanges = isTimeSlotWithinConfiguredRanges;
function parseTime(hour, minute) {
    const hours = Number(hour);
    const minutes = Number(minute);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59)
        return null;
    return hours * 60 + minutes;
}
function parseConfiguredRanges(value) {
    return value.split('/').flatMap((raw) => {
        const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!match)
            return [];
        const start = parseTime(match[1], match[2]);
        const end = parseTime(match[3], match[4]);
        return start !== null && end !== null && start < end ? [{ start, end }] : [];
    });
}
function isTimeSlotWithinConfiguredRanges(ranges, horaInicio, horaFin) {
    const startMatch = horaInicio.match(/^(\d{2}):(\d{2})$/);
    const endMatch = horaFin.match(/^(\d{2}):(\d{2})$/);
    if (!startMatch || !endMatch)
        return false;
    const start = parseTime(startMatch[1], startMatch[2]);
    const end = parseTime(endMatch[1], endMatch[2]);
    if (start === null || end === null || end <= start)
        return false;
    return ranges.some((range) => start >= range.start && start < range.end && end <= range.end);
}
//# sourceMappingURL=timeRanges.js.map
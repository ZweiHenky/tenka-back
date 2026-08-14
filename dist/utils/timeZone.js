"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidTimeZone = isValidTimeZone;
exports.civilToInstant = civilToInstant;
exports.dateKeyInTimeZone = dateKeyInTimeZone;
exports.timeInTimeZone = timeInTimeZone;
exports.addCivilDays = addCivilDays;
const errors_1 = require("./errors");
function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
        return true;
    }
    catch {
        return false;
    }
}
function zonedParts(instant, timeZone) {
    const values = {};
    for (const part of new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant)) {
        if (part.type !== 'literal')
            values[part.type] = Number(part.value);
    }
    return values;
}
function civilToInstant(date, time, timeZone) {
    if (!isValidTimeZone(timeZone))
        throw new errors_1.ValidationError('La zona horaria de la liga no es válida');
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch)
        throw new errors_1.ValidationError('La fecha u hora no es válida');
    const target = {
        year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: 0,
    };
    let epoch = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const actual = zonedParts(new Date(epoch), timeZone);
        const expectedAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
        const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
        const adjustment = expectedAsUtc - actualAsUtc;
        if (adjustment === 0)
            break;
        epoch += adjustment;
    }
    const result = new Date(epoch);
    const resolved = zonedParts(result, timeZone);
    if (resolved.year !== target.year || resolved.month !== target.month || resolved.day !== target.day || resolved.hour !== target.hour || resolved.minute !== target.minute) {
        throw new errors_1.ValidationError('La hora seleccionada no existe en la zona horaria de la liga');
    }
    return result;
}
function dateKeyInTimeZone(instant, timeZone) {
    const parts = zonedParts(instant, timeZone);
    const pad = (value) => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
function timeInTimeZone(instant, timeZone) {
    const parts = zonedParts(instant, timeZone);
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}
function addCivilDays(date, days) {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + days);
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}
//# sourceMappingURL=timeZone.js.map
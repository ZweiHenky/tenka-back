"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const timeZone_1 = require("./timeZone");
(0, vitest_1.describe)('time zone utilities', () => {
    (0, vitest_1.it)('converts league civil time to an absolute instant', () => {
        (0, vitest_1.expect)((0, timeZone_1.civilToInstant)('2026-08-13', '14:00', 'America/Mexico_City').toISOString()).toBe('2026-08-13T20:00:00.000Z');
        (0, vitest_1.expect)((0, timeZone_1.civilToInstant)('2026-08-13', '14:00', 'Europe/Madrid').toISOString()).toBe('2026-08-13T12:00:00.000Z');
    });
    (0, vitest_1.it)('formats an instant in the league zone', () => {
        const instant = new Date('2026-08-13T20:00:00.000Z');
        (0, vitest_1.expect)((0, timeZone_1.dateKeyInTimeZone)(instant, 'America/Mexico_City')).toBe('2026-08-13');
        (0, vitest_1.expect)((0, timeZone_1.timeInTimeZone)(instant, 'America/Mexico_City')).toBe('14:00');
    });
    (0, vitest_1.it)('validates IANA zones', () => {
        (0, vitest_1.expect)((0, timeZone_1.isValidTimeZone)('America/Cancun')).toBe(true);
        (0, vitest_1.expect)((0, timeZone_1.isValidTimeZone)('not-a-zone')).toBe(false);
    });
});
//# sourceMappingURL=timeZone.test.js.map
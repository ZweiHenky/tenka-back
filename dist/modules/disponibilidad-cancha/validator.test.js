"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('availabilityRangeSchema', () => {
    (0, vitest_1.it)('accepts ISO datetimes with offsets and transforms them to dates', () => {
        const result = validator_1.availabilityRangeSchema.parse({
            inicio: '2026-08-01T00:00:00Z',
            fin: '2026-08-02T00:00:00+00:00',
        });
        (0, vitest_1.expect)(result.inicio).toEqual(new Date('2026-08-01T00:00:00.000Z'));
        (0, vitest_1.expect)(result.fin).toEqual(new Date('2026-08-02T00:00:00.000Z'));
    });
    vitest_1.it.each([
        [{ inicio: 'not-a-date', fin: '2026-08-02T00:00:00Z' }, 'ISO'],
        [{ inicio: '2026-08-02T00:00:00Z', fin: '2026-08-01T00:00:00Z' }, 'posterior'],
        [{ inicio: '2026-08-01T00:00:00Z', fin: '2026-09-02T00:00:00Z' }, '31 dias'],
    ])('rejects invalid ranges', (input, message) => {
        const result = validator_1.availabilityRangeSchema.safeParse(input);
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success)
            (0, vitest_1.expect)(result.error.issues[0].message).toContain(message);
    });
    (0, vitest_1.it)('allows exactly 31 days', () => {
        (0, vitest_1.expect)(validator_1.availabilityRangeSchema.safeParse({
            inicio: '2026-08-01T00:00:00Z',
            fin: '2026-09-01T00:00:00Z',
        }).success).toBe(true);
    });
});
//# sourceMappingURL=validator.test.js.map